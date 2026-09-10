import type { SamplerSnapshot } from '../bench/FrameSampler'
import type { EffectStats, OverflowPolicy } from '../effects/types'

import { MAX_DT_SECONDS } from './constants'
import type { FrameTelemetry } from './types'

type MutableTelemetry = { -readonly [K in keyof FrameTelemetry]: FrameTelemetry[K] }

export interface TelemetryInputs {
  readonly snapshot: SamplerSnapshot
  readonly stats: EffectStats
  readonly targetConcurrent: number
  readonly burstsPerSecond: number
  readonly overflow: OverflowPolicy
  readonly totalDrawCalls: number
  readonly pixelRatio: number
  readonly peakRawDtSeconds: number
  readonly emitBehindCamera: boolean
  readonly autoEmission: boolean
  readonly clickBursts: number
}

/**
 * 관측값을 UI가 읽을 형태로 옮기는 곳.
 *
 * 단일 레코드를 계속 재사용한다. 갱신 주기가 4Hz라 매번 새 객체를 만들어도
 * 큰일이 나지는 않지만, 이 레코드는 "측정 결과"이므로 측정 장치가 쓰레기를 만드는 구조는
 * 처음부터 피하는 편이 낫다. 스냅샷이 필요한 호출자는 직접 복사한다.
 *
 * App에서 떼어낸 이유: 필드 20개를 옮겨 담는 코드는 렌더 루프와 섞여 있으면
 * 루프에서 "매 프레임 실제로 무슨 일이 일어나는가"를 읽기 어렵게 만든다.
 */
export class TelemetryRecorder {
  private readonly record: MutableTelemetry

  constructor(capacity: number, overflow: OverflowPolicy) {
    this.record = {
      frameAvgMs: 0,
      frameP95Ms: 0,
      fps: 0,
      cpuFrameAvgMs: 0,
      cpuFrameP95Ms: 0,
      effectAvgMs: 0,
      effectP95Ms: 0,
      targetConcurrent: 0,
      burstsPerSecond: 0,
      aliveCount: 0,
      drawnSlots: 0,
      capacity,
      effectDrawCalls: 0,
      totalDrawCalls: 0,
      burstsDropped: 0,
      particlesRecycled: 0,
      overflow,
      pixelRatio: 1,
      maxRawDtMs: 0,
      maxClampedDtMs: 0,
      effectDisposed: false,
      emitBehindCamera: false,
      autoEmission: false,
      clickBursts: 0,
    }
  }

  update(inputs: TelemetryInputs): FrameTelemetry {
    const r = this.record
    const { snapshot, stats } = inputs

    r.frameAvgMs = snapshot.frameAvgMs
    r.frameP95Ms = snapshot.frameP95Ms
    r.fps = snapshot.fps
    r.cpuFrameAvgMs = snapshot.cpuFrameAvgMs
    r.cpuFrameP95Ms = snapshot.cpuFrameP95Ms
    r.effectAvgMs = snapshot.effectAvgMs
    r.effectP95Ms = snapshot.effectP95Ms
    r.targetConcurrent = inputs.targetConcurrent
    r.burstsPerSecond = inputs.burstsPerSecond
    r.aliveCount = stats.aliveCount
    r.drawnSlots = stats.drawnSlots
    r.capacity = stats.capacity
    r.effectDrawCalls = stats.drawCalls
    r.burstsDropped = stats.burstsDropped
    r.particlesRecycled = stats.particlesRecycled
    r.effectDisposed = stats.disposed
    r.totalDrawCalls = inputs.totalDrawCalls
    r.overflow = inputs.overflow
    r.pixelRatio = inputs.pixelRatio
    r.maxRawDtMs = inputs.peakRawDtSeconds * 1000
    r.maxClampedDtMs = Math.min(inputs.peakRawDtSeconds, MAX_DT_SECONDS) * 1000
    r.emitBehindCamera = inputs.emitBehindCamera
    r.autoEmission = inputs.autoEmission
    r.clickBursts = inputs.clickBursts

    return r
  }
}
