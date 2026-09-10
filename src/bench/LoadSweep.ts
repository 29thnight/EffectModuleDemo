import type { OverflowPolicy } from '../effects/types'

import { LOAD_STEPS, MEASURE_SECONDS, WARMUP_SECONDS } from './constants'
import type { SamplerSnapshot } from './FrameSampler'

export interface SweepLiveSample {
  readonly aliveCount: number
  readonly drawnSlots: number
  readonly burstsDropped: number
  readonly particlesRecycled: number
}

export interface SweepContext {
  readonly sceneLabel: string
  readonly capacity: number
  readonly particlesPerBurst: number
  readonly lifetimeSeconds: number
  readonly overflow: OverflowPolicy
  readonly pixelRatio: number
  readonly viewportWidth: number
  readonly viewportHeight: number
}

export interface SweepStepResult {
  readonly targetConcurrent: number
  readonly burstsPerSecond: number
  readonly aliveAvg: number
  readonly drawnSlotsAvg: number
  readonly fps: number
  readonly frameAvgMs: number
  readonly frameP95Ms: number
  readonly cpuFrameAvgMs: number
  readonly cpuFrameP95Ms: number
  readonly effectAvgMs: number
  readonly effectP95Ms: number
  readonly burstsDropped: number
  readonly particlesRecycled: number
  /**
   * 측정 구간에 실제로 잰 프레임 수. 이 값이 작으면(탭이 가려져 rAF가 멈춘 경우 등)
   * 같은 행의 평균·p95는 통계라 부를 수 없다. 표에 그대로 남겨 독자가 걸러내게 한다.
   */
  readonly sampleCount: number
}

export interface SweepReport {
  readonly startedAt: string
  readonly context: SweepContext
  readonly warmupSeconds: number
  readonly measureSeconds: number
  readonly steps: readonly SweepStepResult[]
}

/** 하네스가 스윕에 제공해야 하는 것. 스윕은 three도 DOM도 모른다. */
export interface SweepHost {
  setConcurrentTarget(n: number): void
  getBurstsPerSecond(): number
  resetSamplers(): void
  snapshot(): SamplerSnapshot
  liveSample(): SweepLiveSample
  describe(): SweepContext
  onProgress(message: string): void
}

type Phase = 'idle' | 'warmup' | 'measure'

/**
 * 부하 스윕. setTimeout이 아니라 하네스의 렌더 루프가 tick()으로 굴린다.
 *
 * setTimeout을 안 쓴 이유: 타이머는 렌더 루프와 어긋난 시각에 깨어나므로
 * "측정 3초"가 실제로는 프레임 경계 중간에서 시작하고 끝난다. 게다가 탭이 백그라운드로
 * 가면 타이머는 스로틀되는데 rAF는 아예 멈춰서, 측정 구간이 0 프레임인 채로 종료될 수 있다.
 * 루프가 굴리면 "몇 프레임을 쟀는가"가 결과에 그대로 남는다.
 */
export class LoadSweep {
  private phase: Phase = 'idle'
  private stepIndex = 0
  private elapsed = 0

  private aliveSum = 0
  private drawnSum = 0
  private tickCount = 0
  private droppedBaseline = 0
  private recycledBaseline = 0

  private steps: SweepStepResult[] = []
  private startedAt = ''
  private settle: {
    readonly resolve: (report: SweepReport) => void
    readonly reject: (reason: Error) => void
  } | null = null

  constructor(private readonly host: SweepHost) {}

  get isRunning(): boolean {
    return this.phase !== 'idle'
  }

  run(): Promise<SweepReport> {
    if (this.isRunning) {
      return Promise.reject(new Error('LoadSweep: 이미 실행 중입니다.'))
    }
    this.steps = []
    this.stepIndex = 0
    this.startedAt = new Date().toISOString()
    this.enterStep(0)

    return new Promise<SweepReport>((resolve, reject) => {
      this.settle = { resolve, reject }
    })
  }

  /** 하네스의 렌더 루프가 매 프레임 호출한다. dt는 클램프된 값이다. */
  tick(dt: number): void {
    if (this.phase === 'idle') return

    this.elapsed += dt

    if (this.phase === 'warmup') {
      if (this.elapsed < WARMUP_SECONDS) return
      this.beginMeasure()
      return
    }

    const live = this.host.liveSample()
    this.aliveSum += live.aliveCount
    this.drawnSum += live.drawnSlots
    this.tickCount++

    if (this.elapsed >= MEASURE_SECONDS) this.finishStep(live)
  }

  /**
   * 하네스가 폐기되거나 측정 전제가 깨졌을 때 부른다.
   * 부분 결과를 resolve하지 않고 reject한다. 절반짜리 표를 "완료"로 돌려주면
   * 호출자는 그것이 전체 스윕인지 알 수 없고, 그 표가 README에 붙는 순간 거짓 데이터가 된다.
   */
  cancel(): void {
    if (this.phase === 'idle') return
    this.phase = 'idle'
    this.host.onProgress('스윕 취소됨')
    const settle = this.settle
    this.settle = null
    settle?.reject(new Error(`스윕이 ${this.steps.length}단계에서 취소되었습니다.`))
  }

  // -- 내부 -------------------------------------------------------------------

  private enterStep(index: number): void {
    const target = LOAD_STEPS[index]
    this.host.setConcurrentTarget(target)
    this.phase = 'warmup'
    this.elapsed = 0
    this.host.onProgress(
      `[${index + 1}/${LOAD_STEPS.length}] 동시 ${target.toLocaleString()}개 워밍업 중...`,
    )
  }

  private beginMeasure(): void {
    const live = this.host.liveSample()
    this.droppedBaseline = live.burstsDropped
    this.recycledBaseline = live.particlesRecycled
    this.aliveSum = 0
    this.drawnSum = 0
    this.tickCount = 0
    this.elapsed = 0
    this.phase = 'measure'
    this.host.resetSamplers()
    this.host.onProgress(
      `[${this.stepIndex + 1}/${LOAD_STEPS.length}] 동시 ${LOAD_STEPS[
        this.stepIndex
      ].toLocaleString()}개 측정 중...`,
    )
  }

  private finishStep(live: SweepLiveSample): void {
    const snapshot = this.host.snapshot()
    const divisor = Math.max(1, this.tickCount)

    this.steps.push({
      targetConcurrent: LOAD_STEPS[this.stepIndex],
      burstsPerSecond: this.host.getBurstsPerSecond(),
      aliveAvg: this.aliveSum / divisor,
      drawnSlotsAvg: this.drawnSum / divisor,
      fps: snapshot.fps,
      frameAvgMs: snapshot.frameAvgMs,
      frameP95Ms: snapshot.frameP95Ms,
      cpuFrameAvgMs: snapshot.cpuFrameAvgMs,
      cpuFrameP95Ms: snapshot.cpuFrameP95Ms,
      effectAvgMs: snapshot.effectAvgMs,
      effectP95Ms: snapshot.effectP95Ms,
      burstsDropped: live.burstsDropped - this.droppedBaseline,
      particlesRecycled: live.particlesRecycled - this.recycledBaseline,
      sampleCount: snapshot.sampleCount,
    })

    this.stepIndex++
    if (this.stepIndex >= LOAD_STEPS.length) {
      this.phase = 'idle'
      this.host.onProgress('스윕 완료')
      this.settleWith()
      return
    }
    this.enterStep(this.stepIndex)
  }

  private settleWith(): void {
    const settle = this.settle
    this.settle = null
    if (!settle) return
    settle.resolve({
      startedAt: this.startedAt,
      context: this.host.describe(),
      warmupSeconds: WARMUP_SECONDS,
      measureSeconds: MEASURE_SECONDS,
      steps: this.steps,
    })
  }
}
