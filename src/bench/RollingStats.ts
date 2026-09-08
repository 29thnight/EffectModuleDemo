/**
 * 고정 크기 링 위의 표본 통계.
 *
 * 평균만 기록하지 않는 이유: 60fps로 도는 것처럼 보이는데 3초에 한 번 40ms가 튀는 상태와
 * 꾸준히 18ms인 상태는 평균이 거의 같지만 체감은 전혀 다르다. 튀는 쪽만 플레이어가 알아챈다.
 * p95는 그 차이를 숫자 하나로 드러낸다.
 *
 * 표본은 Float64Array에 미리 잡아두고 재사용한다. 프레임마다 배열을 늘리면
 * 그 할당과 GC가 그대로 우리가 재려는 프레임 타임에 섞여 들어간다.
 */
export class RollingStats {
  private readonly samples: Float64Array
  private readonly scratch: Float64Array
  private writeIndex = 0
  private filled = 0
  private sum = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RollingStats: capacity는 1 이상의 정수여야 합니다 (받은 값: ${capacity})`)
    }
    this.samples = new Float64Array(capacity)
    this.scratch = new Float64Array(capacity)
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return

    if (this.filled === this.samples.length) {
      this.sum -= this.samples[this.writeIndex]
    } else {
      this.filled++
    }

    this.samples[this.writeIndex] = value
    this.sum += value
    this.writeIndex = (this.writeIndex + 1) % this.samples.length
  }

  reset(): void {
    this.writeIndex = 0
    this.filled = 0
    this.sum = 0
  }

  get count(): number {
    return this.filled
  }

  get mean(): number {
    return this.filled === 0 ? 0 : this.sum / this.filled
  }

  /**
   * @param ratio 0~1. 0.95면 p95.
   * 정렬 대상이 최대 capacity개(기본 240)라 UI 갱신 주기(4Hz)에 호출해도 무시할 만한 비용이다.
   * 매 프레임 부르면 안 된다.
   */
  percentile(ratio: number): number {
    if (this.filled === 0) return 0

    const view = this.scratch.subarray(0, this.filled)
    view.set(this.samples.subarray(0, this.filled))
    view.sort()

    const clamped = Math.min(1, Math.max(0, ratio))
    const index = Math.min(this.filled - 1, Math.max(0, Math.ceil(clamped * this.filled) - 1))
    return view[index]
  }
}
