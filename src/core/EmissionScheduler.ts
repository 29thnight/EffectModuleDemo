import { MAX_BURSTS_PER_FRAME } from './constants'

/**
 * "동시 N개"의 정의를 코드로 못박은 곳.
 *
 * 과제 지문은 "수명 L초 버스트를 초당 N/L회 발생"이라고 되어 있는데, 이 식은 버스트 1회가
 * 파티클 1개일 때만 성립한다. 버스트 1회가 P개를 뱉으면 정상 상태 생존 수는 N x P가 되어
 * 목표를 P배 초과한다. 그래서 여기서는 N을 "동시에 살아있는 파티클 수"로 정의하고
 *
 *     burstsPerSecond = N / (L x P)
 *
 * 로 역산한다. P = 1이면 지문의 N/L과 정확히 같아진다.
 *
 * 근거: 정상 상태에서 초당 생성 = 초당 소멸이므로
 *   alive = burstsPerSecond x P x L  ->  burstsPerSecond = alive / (P x L)
 *
 * 이 정의를 UI와 README에 그대로 노출한다. 정의가 애매한 채로 낸 FPS 숫자는
 * 남이 재현할 수 없고, 재현 못 하는 성능 수치는 없는 것과 같다.
 */
export class EmissionScheduler {
  private burstsPerSecond = 0
  private accumulator = 0
  private targetConcurrent = 0

  /**
   * @param targetConcurrent 정상 상태에서 살아있게 유지할 파티클 수 (N)
   * @param lifetimeSeconds  버스트 파티클의 기준 수명 (L)
   * @param particlesPerBurst 버스트 1회가 생성하는 파티클 수 (P)
   */
  setTarget(targetConcurrent: number, lifetimeSeconds: number, particlesPerBurst: number): void {
    const n = Math.max(0, targetConcurrent)
    const denominator = Math.max(1e-6, lifetimeSeconds * particlesPerBurst)
    this.targetConcurrent = n
    this.burstsPerSecond = n / denominator
    // 목표를 바꾸면 이전 목표에서 밀린 빚은 버린다. 그렇지 않으면 슬라이더를 내린 직후
    // 이전 부하의 잔여 버스트가 한꺼번에 나가 측정 첫 구간이 오염된다.
    this.accumulator = 0
  }

  getBurstsPerSecond(): number {
    return this.burstsPerSecond
  }

  getTargetConcurrent(): number {
    return this.targetConcurrent
  }

  /** 이번 프레임에 발사할 횟수만큼 emit()을 호출하고, 실제 발사 횟수를 돌려준다. */
  tick(dt: number, emit: () => void): number {
    if (this.burstsPerSecond <= 0) {
      this.accumulator = 0
      return 0
    }

    this.accumulator += dt * this.burstsPerSecond

    let fired = 0
    while (this.accumulator >= 1 && fired < MAX_BURSTS_PER_FRAME) {
      this.accumulator -= 1
      emit()
      fired++
    }

    // 한도에 걸렸으면 밀린 빚을 탕감한다. 이월하면 다음 프레임이 더 밀리고,
    // 그 다음 프레임은 더더욱 밀려서 복구가 안 되는 방향으로만 간다.
    if (fired >= MAX_BURSTS_PER_FRAME) this.accumulator = 0

    return fired
  }

  reset(): void {
    this.accumulator = 0
  }
}
