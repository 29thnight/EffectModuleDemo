import type { FrameTelemetry, ProbeKind, SceneId } from '../core/types'
import type { OverflowPolicy } from '../effects/types'

import { button, checkbox, el, radio, select } from './dom'
import './panel.css'

/**
 * 디버그 패널.
 *
 * 이 파일에 three import가 하나도 없다는 점이 핵심이다.
 * 3D 코드는 UI를 전혀 모르고(core는 ui를 import 하지 않는다),
 * UI는 3D를 모른 채 평범한 숫자와 문자열 타입만 안다. 의존은 ui -> core 한 방향뿐이다.
 * 덕분에 패널을 통째로 들어내도 렌더 루프는 그대로 돈다.
 */

export interface DebugPanelOptions {
  readonly scenes: readonly { readonly id: SceneId; readonly label: string }[]
  readonly initialSceneId: SceneId
  readonly loadSteps: readonly number[]
  readonly initialLoadIndex: number
  readonly pixelRatioOptions: readonly (number | null)[]
  readonly initialOverflow: OverflowPolicy
  readonly onSceneChange: (id: SceneId) => void
  readonly onLoadChange: (target: number) => void
  readonly onOverflowChange: (policy: OverflowPolicy) => void
  readonly onPixelRatioChange: (value: number | null) => void
  readonly onEmitBehindCameraChange: (enabled: boolean) => void
  readonly onProbe: (kind: ProbeKind) => void
  readonly onRunSweep: () => void
}

const STAT_ROWS: readonly (readonly [string, string])[] = [
  ['fps', 'FPS (avg)'],
  ['frame', '프레임 avg / p95'],
  ['cpuFrame', 'CPU 프레임 avg / p95'],
  ['effect', '이펙트 CPU avg / p95'],
  ['alive', '생존 / 목표 N'],
  ['drawn', 'draw 슬롯 / 용량'],
  ['calls', '드로우콜 이펙트 / 전체'],
  ['rate', 'bursts / s'],
  ['pool', '드롭 / 재활용'],
  ['dpr', 'DPR'],
  ['dt', 'dt 관측최대 raw → clamp'],
  ['state', '상태'],
]

/** p95가 이 값을 넘으면 60fps 예산(16.7ms)을 못 지키고 있다는 뜻이라 강조한다. */
const FRAME_BUDGET_MS = 16.7

const MAX_LOG_LINES = 40

export class DebugPanel {
  private readonly root: HTMLElement
  private readonly values = new Map<string, HTMLElement>()
  private readonly loadLabel: HTMLElement
  private readonly slider: HTMLInputElement
  private readonly sweepButton: HTMLButtonElement
  private readonly progress: HTMLElement
  private readonly logBox: HTMLElement
  private readonly report: HTMLTextAreaElement
  private readonly logLines: string[] = []

  constructor(
    private readonly host: HTMLElement,
    private readonly options: DebugPanelOptions,
  ) {
    this.loadLabel = el('div')
    this.slider = this.createSlider()
    this.sweepButton = button('부하 스윕 실행', options.onRunSweep)
    this.progress = el('p', { class: 'dbg-note' }, ['대기 중'])
    this.logBox = el('pre', { class: 'dbg-log' })
    this.report = el('textarea', {
      class: 'dbg-report',
      readonly: 'readonly',
      placeholder: '스윕을 실행하면 여기에 마크다운 표가 나옵니다.',
    })

    this.root = el('aside', { class: 'dbg' }, [
      el('h1', {}, ['ImpactBurst 데모 · 디버그']),
      this.buildSceneSection(),
      this.buildLoadSection(),
      this.buildEffectSection(),
      this.buildStatsSection(),
      this.buildProbeSection(),
      this.buildSweepSection(),
      this.buildLogSection(),
    ])

    this.host.append(this.root)
    this.updateLoadLabel()
  }

  setTelemetry(t: FrameTelemetry): void {
    this.setStat('fps', t.fps.toFixed(1), t.fps > 0 && t.fps < 55)
    this.setStat('frame', pair(t.frameAvgMs, t.frameP95Ms), t.frameP95Ms > FRAME_BUDGET_MS)
    this.setStat('cpuFrame', pair(t.cpuFrameAvgMs, t.cpuFrameP95Ms))
    this.setStat('effect', pair(t.effectAvgMs, t.effectP95Ms))
    this.setStat('alive', `${int(t.aliveCount)} / ${int(t.targetConcurrent)}`)
    this.setStat('drawn', `${int(t.drawnSlots)} / ${int(t.capacity)}`)
    this.setStat('calls', `${t.effectDrawCalls} / ${t.totalDrawCalls}`, t.effectDrawCalls > 1)
    this.setStat('rate', t.burstsPerSecond.toFixed(1))
    this.setStat(
      'pool',
      `${int(t.burstsDropped)} / ${int(t.particlesRecycled)}`,
      t.burstsDropped > 0 || t.particlesRecycled > 0,
    )
    this.setStat('dpr', t.pixelRatio.toFixed(2))
    this.setStat(
      'dt',
      `${t.maxRawDtMs.toFixed(1)} → ${t.maxClampedDtMs.toFixed(1)} ms`,
      t.maxRawDtMs - t.maxClampedDtMs > 1,
    )
    this.setStat('state', describeState(t), t.effectDisposed || t.emitBehindCamera)

    // 부하 표시는 슬라이더가 아니라 하네스가 알려준 실제 목표를 따른다.
    // bursts/s도 하네스가 씬의 선언된 수명에서 역산하므로 씬 전환 때 같이 바뀐다.
    this.updateLoadLabel(t.targetConcurrent, t.burstsPerSecond)
    this.syncSliderToTarget(t.targetConcurrent)
  }

  log(message: string): void {
    this.logLines.push(message)
    if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift()
    this.logBox.textContent = this.logLines.join('\n')
    this.logBox.scrollTop = this.logBox.scrollHeight
  }

  /** 하네스가 부하를 바꿨을 때(스윕 종료 등) 슬라이더를 따라오게 한다. */
  setLoadIndex(index: number): void {
    const clamped = Math.min(this.options.loadSteps.length - 1, Math.max(0, index))
    this.slider.value = String(clamped)
    this.updateLoadLabel()
  }

  setSweepBusy(busy: boolean): void {
    this.sweepButton.disabled = busy
    this.slider.disabled = busy
  }

  setSweepProgress(message: string): void {
    this.progress.textContent = message
  }

  setReport(text: string): void {
    this.report.value = text
  }

  dispose(): void {
    this.root.remove()
  }

  // -- 조립 --------------------------------------------------------------------

  private buildSceneSection(): HTMLElement {
    const rows = this.options.scenes.map((scene) =>
      radio('dbg-scene', scene.id, scene.label, scene.id === this.options.initialSceneId, (value) =>
        this.options.onSceneChange(value as SceneId),
      ),
    )
    return el('section', {}, [el('h2', {}, ['씬']), ...rows])
  }

  private createSlider(): HTMLInputElement {
    const node = el('input', {
      type: 'range',
      min: '0',
      max: String(this.options.loadSteps.length - 1),
      step: '1',
    })
    node.value = String(this.options.initialLoadIndex)
    node.addEventListener('input', () => {
      this.updateLoadLabel()
      this.options.onLoadChange(this.currentLoadTarget())
    })
    return node
  }

  private buildLoadSection(): HTMLElement {
    return el('section', {}, [
      el('h2', {}, ['부하 (동시 생존 파티클 N)']),
      this.loadLabel,
      this.slider,
      el('p', { class: 'dbg-note' }, ['bursts/s = N / (수명 L × 버스트당 P)']),
    ])
  }

  private buildEffectSection(): HTMLElement {
    const overflow = select(
      [
        { value: 'recycle-oldest', label: '오버플로: 가장 오래된 것 재활용' },
        { value: 'drop-burst', label: '오버플로: 버스트 통째 드롭' },
      ],
      this.options.initialOverflow,
      (value) => this.options.onOverflowChange(value as OverflowPolicy),
    )

    const dpr = select(
      this.options.pixelRatioOptions.map((value) => ({
        value: value === null ? 'auto' : String(value),
        label: value === null ? 'DPR: 기기 값 (씬 프로필 상한 적용)' : `DPR: ${value} 고정`,
      })),
      'auto',
      (value) => this.options.onPixelRatioChange(value === 'auto' ? null : Number(value)),
    )

    return el('section', {}, [
      el('h2', {}, ['이펙트 옵션']),
      overflow,
      el('p', { class: 'dbg-note' }, ['생성 시 고정 옵션 → 바꾸면 인스턴스를 재생성합니다.']),
      dpr,
    ])
  }

  private buildStatsSection(): HTMLElement {
    const list = el('dl', { class: 'dbg-stats' })
    for (const [key, label] of STAT_ROWS) {
      const value = el('dd', {}, ['—'])
      this.values.set(key, value)
      list.append(el('dt', {}, [label]), value)
    }
    return el('section', {}, [el('h2', {}, ['측정']), list])
  }

  private buildProbeSection(): HTMLElement {
    return el('section', {}, [
      el('h2', {}, ['비정상 상황 검증']),
      button('dt 폭주 주입', () => this.options.onProbe('dt-spike')),
      button('dispose 후 호출', () => this.options.onProbe('dispose-then-call')),
      button('풀 고갈', () => this.options.onProbe('pool-exhaust')),
      button('부하·관측 리셋', () => this.options.onProbe('reset-load')),
      checkbox('절두체 밖에서 발사', false, this.options.onEmitBehindCameraChange),
    ])
  }

  private buildSweepSection(): HTMLElement {
    return el('section', {}, [
      el('h2', {}, ['부하 스윕']),
      this.sweepButton,
      button('결과 복사', () => {
        void this.copyReport()
      }),
      this.progress,
      this.report,
    ])
  }

  private buildLogSection(): HTMLElement {
    return el('section', {}, [el('h2', {}, ['로그']), this.logBox])
  }

  // -- 내부 --------------------------------------------------------------------

  private currentLoadTarget(): number {
    const index = Number(this.slider.value)
    return this.options.loadSteps[index] ?? 0
  }

  /**
   * 하네스가 알려준 실제 목표를 우선한다. 슬라이더 값은 텔레메트리가 오기 전
   * (초기화 직후, 드래그하는 그 순간)에만 쓴다.
   *
   * 슬라이더에서만 N을 읽으면 「풀 고갈」처럼 하네스가 직접 부하를 바꿨을 때
   * `N = 2,000 · 5,555.6 bursts/s` 같은 자기모순 표시가 나온다. 실제로 그렇게 나왔다 —
   * 2,000이면 92.6이어야 하는데 속도만 진짜 목표(120,000)를 반영하고 있었다.
   * 계기가 거짓말을 하면 그 아래 숫자를 전부 못 믿게 된다.
   */
  private updateLoadLabel(target?: number, burstsPerSecond?: number): void {
    const n = target ?? this.currentLoadTarget()
    const rate = burstsPerSecond === undefined ? '' : ` · ${burstsPerSecond.toFixed(1)} bursts/s`
    this.loadLabel.textContent = `N = ${int(n)}${rate}`
  }

  /**
   * 하네스가 부하를 바꿨고 그 값이 슬라이더 눈금에 있으면 손잡이를 따라오게 한다.
   * 눈금 밖 값(「풀 고갈」의 120,000)이면 손잡이는 그대로 두고 라벨만 진짜 값을 보여준다 —
   * 없는 눈금으로 손잡이를 옮기면 그게 또 다른 거짓말이 된다.
   */
  private syncSliderToTarget(target: number): void {
    const index = this.options.loadSteps.indexOf(target)
    if (index < 0) return
    const next = String(index)
    if (this.slider.value !== next) this.slider.value = next
  }

  private setStat(key: string, text: string, warn = false): void {
    const node = this.values.get(key)
    if (!node) return
    node.textContent = text
    node.classList.toggle('warn', warn)
  }

  private async copyReport(): Promise<void> {
    if (!this.report.value) {
      this.log('복사할 스윕 결과가 없습니다.')
      return
    }
    try {
      await navigator.clipboard.writeText(this.report.value)
      this.log('스윕 결과를 클립보드에 복사했습니다.')
    } catch {
      // 클립보드 권한이 없거나 비보안 컨텍스트일 수 있다. 조용히 삼키지 말고 대안을 준다.
      this.report.select()
      this.log('클립보드 접근이 거부되어 텍스트를 선택했습니다. Ctrl+C로 복사하세요.')
    }
  }
}

const ms = (value: number): string => value.toFixed(2)
const int = (value: number): string => Math.round(value).toLocaleString()
const pair = (avg: number, p95: number): string => `${ms(avg)} / ${ms(p95)} ms`

function describeState(t: FrameTelemetry): string {
  const flags: string[] = []
  if (t.effectDisposed) flags.push('disposed')
  if (t.emitBehindCamera) flags.push('절두체 밖')
  flags.push(t.overflow === 'recycle-oldest' ? '재활용' : '드롭')
  return flags.join(' · ')
}
