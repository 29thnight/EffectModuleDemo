import { Vector2, Vector3, type WebGLRenderer } from 'three'

import { DEFAULT_LOAD_INDEX, LOAD_STEPS } from '../bench/constants'
import { FrameSampler, type SamplerSnapshot } from '../bench/FrameSampler'
import {
  LoadSweep,
  type SweepContext,
  type SweepHost,
  type SweepLiveSample,
  type SweepReport,
} from '../bench/LoadSweep'
import { DEFAULT_EFFECT_CONFIG, DEFAULT_EFFECT_STYLE } from '../effects/constants'
import { ImpactBurst } from '../effects/ImpactBurst'
import type {
  EffectModule,
  EmitPoint,
  ImpactBurstConfig,
  OverflowPolicy,
} from '../effects/types'
import { IndoorScene } from '../scenes/IndoorScene'
import { OutdoorScene } from '../scenes/OutdoorScene'

import { type AppCallbacks, withCallbackDefaults } from './callbacks'
import {
  BEHIND_CAMERA_DISTANCE,
  DT_SPIKE_INJECTION_SECONDS,
  DT_SPIKE_LOG_THRESHOLD_SECONDS,
  MAX_DT_SECONDS,
  POOL_EXHAUST_TARGET,
  UI_REFRESH_SECONDS,
} from './constants'
import { EmissionScheduler } from './EmissionScheduler'
import { exerciseDisposedModule } from './probes'
import { applyRendererProfile, applyViewport, createRenderer } from './renderer'
import { TelemetryRecorder } from './Telemetry'
import type { ProbeKind, SceneId, SceneModule } from './types'

/**
 * 하네스. 이펙트 인스턴스를 소유하고, 씬은 빌려 쓴다.
 *
 * 씬마다 이펙트를 두면 전환할 때마다 60,000 슬롯짜리 버퍼가 새로 할당된다. 그래서 여기서 하나만 갖는다.
 * 대가는 전환 시점에 살아있던 파티클이 새 씬으로 넘어오는 것 — 버그가 아니라 그 선택의 청구서이고,
 * 최대 수명(1.4초) 안에 자연 소멸한다.
 * 이월 파티클의 스타일 처리와 버린 대안은 docs/DECISIONS.md C-1, C-2에 있다.
 */
export class App implements SweepHost {
  private readonly renderer: WebGLRenderer
  private readonly canvas: HTMLCanvasElement
  private readonly callbacks: AppCallbacks

  private readonly scenes: Record<SceneId, SceneModule>
  private active: SceneModule

  private effects: EffectModule
  private effectConfig: ImpactBurstConfig

  private readonly scheduler = new EmissionScheduler()
  private readonly sampler = new FrameSampler()
  private readonly sweep: LoadSweep

  private readonly emitPoint: EmitPoint = {
    position: new Vector3(),
    direction: new Vector3(0, 1, 0),
  }
  private readonly cameraForward = new Vector3()
  private readonly drawingBuffer = new Vector2()
  private readonly recorder: TelemetryRecorder

  private rafId = 0
  private lastTimestamp = 0
  private elapsed = 0
  private uiAccumulator = 0
  private injectedDt = 0
  private targetConcurrent = LOAD_STEPS[DEFAULT_LOAD_INDEX]
  private pixelRatioOverride: number | null = null
  private lastDevicePixelRatio = 1
  private emitBehindCamera = false
  private totalDrawCalls = 0
  private peakRawDt = 0

  constructor(canvas: HTMLCanvasElement, callbacks: Partial<AppCallbacks> = {}) {
    this.canvas = canvas
    this.callbacks = withCallbackDefaults(callbacks)

    this.scenes = { indoor: new IndoorScene(), outdoor: new OutdoorScene() }
    this.active = this.scenes.indoor

    this.renderer = createRenderer(canvas)

    this.effectConfig = { ...DEFAULT_EFFECT_CONFIG }
    this.effects = new ImpactBurst(this.effectConfig, this.active.effectStyle)
    this.active.attachEffects(this.effects.object3D)

    this.sweep = new LoadSweep(this)
    this.recorder = new TelemetryRecorder(
      this.active.id,
      this.active.label,
      this.effectConfig.capacity,
      this.effectConfig.overflow,
    )

    applyRendererProfile(this.renderer, this.active.rendererProfile)
    this.syncScheduler()
    this.resize()

    window.addEventListener('resize', this.handleResize)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
  }

  start(): void {
    if (this.rafId !== 0) return
    this.lastTimestamp = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  dispose(): void {
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    window.removeEventListener('resize', this.handleResize)
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)

    // 이펙트는 하네스 소유물이므로 하네스가 회수한다. 씬은 자기 것만 회수한다.
    this.effects.dispose()
    for (const scene of Object.values(this.scenes)) scene.dispose()
    this.renderer.dispose()
  }

  // -- 조작 표면 ---------------------------------------------------------------

  /** UI가 씬 목록을 만들 때 쓴다. THREE 객체는 넘기지 않고 id와 라벨만 넘긴다. */
  get sceneList(): readonly { readonly id: SceneId; readonly label: string }[] {
    return Object.values(this.scenes).map((scene) => ({ id: scene.id, label: scene.label }))
  }

  get activeSceneId(): SceneId {
    return this.active.id
  }

  setScene(id: SceneId): void {
    if (this.active.id === id) return
    this.active = this.scenes[id]
    applyRendererProfile(this.renderer, this.active.rendererProfile)
    // Object3D는 부모가 하나뿐이다. add() 한 번으로 이전 씬에서 자동으로 빠지므로
    // 하네스가 remove()를 따로 부를 필요가 없다 — 씬이 알아야 할 것이 하나 줄어든다.
    this.active.attachEffects(this.effects.object3D)
    this.effects.setStyle(this.active.effectStyle)
    this.syncScheduler()
    this.resize()
    this.sampler.reset()
    this.peakRawDt = 0
    this.callbacks.onLog(`씬 전환: ${this.active.label}`)
    this.publishTelemetry()
  }

  setConcurrentTarget(target: number): void {
    this.targetConcurrent = Math.max(0, target)
    this.syncScheduler()
  }

  /** 생성 시 고정 옵션이라 인스턴스를 새로 만든다. "재할당이 숨어 있지 않다"는 것이 이 API의 요점이다. */
  setOverflowPolicy(overflow: OverflowPolicy): void {
    if (this.effectConfig.overflow === overflow) return
    this.recreateEffects({ ...this.effectConfig, overflow })
    this.callbacks.onLog(`오버플로 정책을 '${overflow}'로 바꾸며 이펙트 인스턴스를 재생성했습니다.`)
    this.publishTelemetry()
  }

  setPixelRatioOverride(value: number | null): void {
    this.pixelRatioOverride = value
    this.resize()
  }

  setEmitBehindCamera(enabled: boolean): void {
    this.emitBehindCamera = enabled
    this.callbacks.onLog(
      enabled
        ? `발사 지점을 카메라 뒤 ${BEHIND_CAMERA_DISTANCE}m로 강제합니다 (절두체 밖 발생).`
        : '발사 지점을 씬 기본값으로 되돌립니다.',
    )
  }

  runSweep(): Promise<SweepReport> {
    return this.sweep.run()
  }

  runProbe(kind: ProbeKind): void {
    switch (kind) {
      case 'dt-spike':
        this.injectedDt += DT_SPIKE_INJECTION_SECONDS
        this.callbacks.onLog(
          `dt에 ${DT_SPIKE_INJECTION_SECONDS}초를 주입합니다. 다음 프레임의 클램프 결과를 보세요.`,
        )
        break
      case 'pool-exhaust':
        this.setConcurrentTarget(POOL_EXHAUST_TARGET)
        this.callbacks.onLog(
          `동시 목표를 ${POOL_EXHAUST_TARGET.toLocaleString()}개로 올립니다 (용량 ${this.effectConfig.capacity.toLocaleString()}개 초과).`,
        )
        break
      case 'reset-load':
        this.resetToBaseline()
        break
      case 'dispose-then-call':
        this.probeDisposeThenCall()
        break
    }

    // 조작 즉시 계기에 반영한다. 4Hz 갱신만 기다리면 렌더 루프가 멈춰 있는 동안
    // (탭 복귀 직후, 창이 가려진 동안) 버튼을 눌러도 화면이 그대로라,
    // "리셋이 안 먹은 것"과 "먹었는데 표시가 안 바뀐 것"을 구분할 수 없다.
    this.publishTelemetry()
  }

  // -- SweepHost 구현 ----------------------------------------------------------

  getBurstsPerSecond(): number {
    return this.scheduler.getBurstsPerSecond()
  }

  resetSamplers(): void {
    this.sampler.reset()
  }

  snapshot(): SamplerSnapshot {
    return this.sampler.snapshot()
  }

  liveSample(): SweepLiveSample {
    const stats = this.effects.stats
    return {
      aliveCount: stats.aliveCount,
      drawnSlots: stats.drawnSlots,
      burstsDropped: stats.burstsDropped,
      particlesRecycled: stats.particlesRecycled,
    }
  }

  describe(): SweepContext {
    this.renderer.getDrawingBufferSize(this.drawingBuffer)
    return {
      sceneLabel: this.active.label,
      capacity: this.effectConfig.capacity,
      particlesPerBurst: this.effectConfig.particlesPerBurst,
      lifetimeSeconds: this.activeLifetime(),
      overflow: this.effectConfig.overflow,
      pixelRatio: this.renderer.getPixelRatio(),
      viewportWidth: this.drawingBuffer.x,
      viewportHeight: this.drawingBuffer.y,
    }
  }

  onProgress(message: string): void {
    this.callbacks.onSweepProgress(message)
  }

  // -- 루프 --------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame)

    const rawDt = this.lastTimestamp === 0 ? 0 : (now - this.lastTimestamp) / 1000
    this.lastTimestamp = now

    const injected = this.injectedDt
    this.injectedDt = 0
    const requestedDt = rawDt + injected
    const dt = Math.min(requestedDt, MAX_DT_SECONDS)
    this.elapsed += dt

    if (window.devicePixelRatio !== this.lastDevicePixelRatio) this.resize()

    const cpuStart = performance.now()

    this.active.update(dt, this.elapsed)
    // 호출 순서 계약: burst -> update -> render.
    // ImpactBurst.update()가 이번 프레임에 생성된 슬롯까지 업로드 구간에 넣기 때문이다.
    this.scheduler.tick(dt, this.emitOnce)
    this.effects.update(dt)
    this.renderer.render(this.active.scene, this.active.camera)

    const cpuMs = performance.now() - cpuStart
    this.totalDrawCalls = this.renderer.info.render.calls

    if (rawDt > 0) this.sampler.push(rawDt * 1000, cpuMs, this.effects.stats.cpuUpdateMs)
    if (this.sweep.isRunning) this.sweep.tick(dt)

    if (requestedDt > this.peakRawDt) {
      this.peakRawDt = requestedDt
      if (requestedDt > DT_SPIKE_LOG_THRESHOLD_SECONDS) {
        this.callbacks.onLog(
          `dt 폭주 감지: raw ${(requestedDt * 1000).toFixed(0)}ms -> clamp ${(dt * 1000).toFixed(0)}ms ` +
            '(파티클이 한 프레임에 수명을 소진하거나 화면 밖으로 날아가지 않습니다)',
        )
      }
    }

    this.uiAccumulator += dt
    if (this.uiAccumulator >= UI_REFRESH_SECONDS) {
      this.uiAccumulator = 0
      this.publishTelemetry()
    }
  }

  private readonly emitOnce = (): void => {
    const point = this.active.getEmitPoint(this.emitPoint)
    if (this.emitBehindCamera) {
      this.active.camera.getWorldDirection(this.cameraForward)
      point.position
        .copy(this.active.camera.position)
        .addScaledVector(this.cameraForward, -BEHIND_CAMERA_DISTANCE)
    }
    this.effects.burst(point)
  }

  private readonly handleResize = (): void => {
    this.resize()
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.callbacks.onLog('WebGL 컨텍스트가 소실되었습니다. 페이지를 새로고침하세요.')
  }

  // -- 내부 --------------------------------------------------------------------

  private resize(): void {
    this.lastDevicePixelRatio = window.devicePixelRatio || 1
    const size = applyViewport(
      this.renderer,
      this.canvas,
      this.active.rendererProfile,
      this.pixelRatioOverride,
      this.drawingBuffer,
    )
    this.active.resize(size.width, size.height)
    this.effects.setViewport(this.drawingBuffer.x, this.drawingBuffer.y)
  }

  private activeLifetime(): number {
    return this.active.effectStyle.lifetime ?? DEFAULT_EFFECT_STYLE.lifetime
  }

  private syncScheduler(): void {
    this.scheduler.setTarget(
      this.targetConcurrent,
      this.activeLifetime(),
      this.effectConfig.particlesPerBurst,
    )
  }

  private recreateEffects(config: ImpactBurstConfig): void {
    this.effects.dispose()
    this.effectConfig = config
    this.effects = new ImpactBurst(config, this.active.effectStyle)
    this.active.attachEffects(this.effects.object3D)
    this.syncScheduler()
    this.resize()
  }

  /**
   * 부하와 관측값을 함께 기준선으로 되돌린다.
   * dt 행은 관측 최댓값 래치라, 여기서 안 풀어주면 씬 전환 말고는 푸는 방법이 없었다.
   */
  private resetToBaseline(): void {
    this.setConcurrentTarget(LOAD_STEPS[DEFAULT_LOAD_INDEX])
    this.peakRawDt = 0
    this.sampler.reset()
    this.callbacks.onLog(
      '부하를 기본값으로 되돌리고 관측값(dt 최댓값·프레임 표본)을 초기화했습니다. ' +
        '이미 발사된 파티클은 수명이 다할 때까지 남습니다.',
    )
  }

  private probeDisposeThenCall(): void {
    this.callbacks.onLog(exerciseDisposedModule(this.effects, this.emitPoint))
    // 데모를 계속 쓸 수 있도록 새 인스턴스로 갈아끼운다.
    this.effects = new ImpactBurst(this.effectConfig, this.active.effectStyle)
    this.active.attachEffects(this.effects.object3D)
    this.resize()
    this.callbacks.onLog('새 이펙트 인스턴스로 교체했습니다.')
  }

  private publishTelemetry(): void {
    this.callbacks.onTelemetry(
      this.recorder.update({
        sceneId: this.active.id,
        sceneLabel: this.active.label,
        snapshot: this.sampler.snapshot(),
        stats: this.effects.stats,
        targetConcurrent: this.scheduler.getTargetConcurrent(),
        burstsPerSecond: this.scheduler.getBurstsPerSecond(),
        overflow: this.effectConfig.overflow,
        totalDrawCalls: this.totalDrawCalls,
        pixelRatio: this.renderer.getPixelRatio(),
        peakRawDtSeconds: this.peakRawDt,
        emitBehindCamera: this.emitBehindCamera,
      }),
    )
  }
}
