import { type Intersection, Vector3 } from 'three'

import type { EffectModule, EmitPoint } from '../effects/types'

import { ClickEmitter } from './ClickEmitter'
import { BEHIND_CAMERA_DISTANCE, CLICK_BURST_COUNT, DEFAULT_AUTO_EMISSION } from './constants'
import { EmissionScheduler } from './EmissionScheduler'
import type { SceneModule } from './types'

export interface EmissionHost {
  /** 지금 활성화된 씬. 씬 전환 뒤에도 리스너를 다시 달지 않도록 매번 묻는다. */
  readonly activeScene: () => SceneModule
  /** 인스턴스는 재생성될 수 있으므로(오버플로 정책 변경, dispose 프로브) 매번 묻는다. */
  readonly effects: () => EffectModule
  readonly onLog: (message: string) => void
  /** 클릭처럼 사람이 만든 사건은 4Hz 갱신을 기다리지 않고 계기에 바로 반영한다. */
  readonly onChanged: () => void
}

/**
 * 발사 경로 두 갈래를 한 곳에 모은다.
 *
 *   자동  EmissionScheduler가 "동시 N개"에서 역산한 속도로, 씬의 getEmitPoint()가 고른 자리에.
 *         부하 측정용. 기본은 꺼져 있다(DEFAULT_AUTO_EMISSION).
 *   클릭  캔버스 클릭 지점을 scene.children 전체에 레이캐스트해, 맞은 지점·법선에.
 *         인터랙션용. 항상 켜져 있다.
 *
 * 둘 다 마지막에는 effects.burst(point) 한 줄로 끝난다. 모듈은 누가 불렀는지 모른다 —
 * 그래서 이 파일이 App에 있지 않고 따로 있다. 발사 경로가 늘면 여기만 늘어야 한다.
 */
export class Emission {
  private readonly scheduler = new EmissionScheduler()
  private readonly clicks: ClickEmitter
  private readonly emitPoint: EmitPoint = {
    position: new Vector3(),
    direction: new Vector3(0, 1, 0),
  }
  private readonly cameraForward = new Vector3()

  private autoEnabled = DEFAULT_AUTO_EMISSION
  private behindCamera = false
  private clickBurstTotal = 0

  constructor(
    canvas: HTMLCanvasElement,
    private readonly host: EmissionHost,
  ) {
    this.clicks = new ClickEmitter(canvas, {
      target: () => host.activeScene(),
      onHit: this.handleClickHit,
      onMiss: this.handleClickMiss,
    })
  }

  dispose(): void {
    this.clicks.dispose()
  }

  // -- 관측 --------------------------------------------------------------------

  get isAutoEnabled(): boolean {
    return this.autoEnabled
  }

  get isBehindCamera(): boolean {
    return this.behindCamera
  }

  get targetConcurrent(): number {
    return this.scheduler.getTargetConcurrent()
  }

  /** 자동 발사가 꺼져 있으면 0. 계기와 스윕 보고서가 같은 값을 보게 한다. */
  get burstsPerSecond(): number {
    return this.autoEnabled ? this.scheduler.getBurstsPerSecond() : 0
  }

  get clickBursts(): number {
    return this.clickBurstTotal
  }

  /** dispose 프로브가 "아무 좌표"로 두들길 때 쓰는 그릇. */
  get probePoint(): EmitPoint {
    return this.emitPoint
  }

  // -- 조작 --------------------------------------------------------------------

  setTarget(targetConcurrent: number, lifetimeSeconds: number, particlesPerBurst: number): void {
    this.scheduler.setTarget(targetConcurrent, lifetimeSeconds, particlesPerBurst)
  }

  setAuto(enabled: boolean): void {
    if (this.autoEnabled === enabled) return
    this.autoEnabled = enabled
    this.host.onLog(
      enabled
        ? '자동 발사를 켭니다. 이제부터 목표 N을 유지하도록 씬이 고른 자리에 발사합니다.'
        : '자동 발사를 끕니다. 클릭 발사만 남습니다. 이미 발사된 파티클은 수명을 다 삽니다.',
    )
  }

  /** 스윕 동안 자동 발사를 강제한다. 돌려주는 함수가 원래 상태로 되돌린다. */
  forceAuto(): () => void {
    const previous = this.autoEnabled
    this.setAuto(true)
    return () => this.setAuto(previous)
  }

  setBehindCamera(enabled: boolean): void {
    this.behindCamera = enabled
    this.host.onLog(
      enabled
        ? `자동 발사 지점을 카메라 뒤 ${BEHIND_CAMERA_DISTANCE}m로 강제합니다 (절두체 밖 발생). 클릭 발사는 영향 없음.`
        : '자동 발사 지점을 씬 기본값으로 되돌립니다.',
    )
  }

  /** 렌더 루프가 매 프레임 부른다. 호출 순서 계약(burst -> update -> render)은 App이 지킨다. */
  tick(dt: number): void {
    if (!this.autoEnabled) return
    this.scheduler.tick(dt, this.emitOnce)
  }

  // -- 내부 --------------------------------------------------------------------

  private readonly emitOnce = (): void => {
    const scene = this.host.activeScene()
    const point = scene.getEmitPoint(this.emitPoint)
    if (this.behindCamera) {
      scene.camera.getWorldDirection(this.cameraForward)
      point.position
        .copy(scene.camera.position)
        .addScaledVector(this.cameraForward, -BEHIND_CAMERA_DISTANCE)
    }
    this.host.effects().burst(point)
  }

  private readonly handleClickHit = (point: EmitPoint, hit: Intersection): void => {
    const effects = this.host.effects()
    for (let i = 0; i < CLICK_BURST_COUNT; i++) effects.burst(point)
    this.clickBurstTotal += CLICK_BURST_COUNT

    const p = point.position
    const n = point.direction
    this.host.onLog(
      `클릭 발사 #${this.clickBurstTotal}: 위치 (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ` +
        `· 법선 (${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)}) · 거리 ${hit.distance.toFixed(1)}m`,
    )
    this.host.onChanged()
  }

  private readonly handleClickMiss = (): void => {
    // 충돌 지점이 없으면 파편도 없다. 허공에 임의 거리로 발사하는 대안은 docs/DECISIONS.md C-10.
    this.host.onLog('클릭 빗나감: 레이가 맞은 물체가 없어 발사하지 않습니다.')
  }
}
