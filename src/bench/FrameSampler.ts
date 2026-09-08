import { REPORT_PERCENTILE, SAMPLE_CAPACITY } from './constants'
import { RollingStats } from './RollingStats'

/**
 * 세 계열을 따로 잰다. 하나로 합치면 병목이 어디인지 알 수 없다.
 *
 *   frame     : rAF 콜백 간격. vsync 대기 + GPU 시간까지 포함된 "화면에 실제로 나온 프레임 타임".
 *   cpuFrame  : 우리 JS가 돈 시간(씬 update + 이펙트 update + 드로우 콜 제출).
 *   effect    : 그중 이펙트 CPU 적분만.
 *
 * 읽는 법:
 *   frame >> cpuFrame        -> CPU는 놀고 있다. 병목은 GPU(프래그먼트 오버드로우) 또는 vsync.
 *   frame ~= cpuFrame        -> 병목은 CPU다.
 *   cpuFrame ~= effect       -> 그 CPU 시간의 대부분이 파티클 적분이다. GPU 적분으로 옮길 근거.
 *   cpuFrame >> effect       -> 파티클은 죄가 없다. 씬 쪽이나 드로우 콜 제출을 봐야 한다.
 *
 * 이 구분이 없으면 "느리다"까지만 알고 "다음에 뭘 고쳐야 하나"는 못 고른다.
 */
export interface SamplerSnapshot {
  readonly frameAvgMs: number
  readonly frameP95Ms: number
  readonly fps: number
  readonly cpuFrameAvgMs: number
  readonly cpuFrameP95Ms: number
  readonly effectAvgMs: number
  readonly effectP95Ms: number
  readonly sampleCount: number
}

export class FrameSampler {
  private readonly frame = new RollingStats(SAMPLE_CAPACITY)
  private readonly cpuFrame = new RollingStats(SAMPLE_CAPACITY)
  private readonly effect = new RollingStats(SAMPLE_CAPACITY)

  /** 매 프레임 호출. 여기서는 통계를 계산하지 않는다 (push는 O(1)). */
  push(frameMs: number, cpuFrameMs: number, effectMs: number): void {
    this.frame.push(frameMs)
    this.cpuFrame.push(cpuFrameMs)
    this.effect.push(effectMs)
  }

  reset(): void {
    this.frame.reset()
    this.cpuFrame.reset()
    this.effect.reset()
  }

  /** 정렬이 들어가므로 매 프레임이 아니라 UI 갱신 주기에만 호출한다. */
  snapshot(): SamplerSnapshot {
    const frameAvgMs = this.frame.mean
    return {
      frameAvgMs,
      frameP95Ms: this.frame.percentile(REPORT_PERCENTILE),
      fps: frameAvgMs > 0 ? 1000 / frameAvgMs : 0,
      cpuFrameAvgMs: this.cpuFrame.mean,
      cpuFrameP95Ms: this.cpuFrame.percentile(REPORT_PERCENTILE),
      effectAvgMs: this.effect.mean,
      effectP95Ms: this.effect.percentile(REPORT_PERCENTILE),
      sampleCount: this.frame.count,
    }
  }
}
