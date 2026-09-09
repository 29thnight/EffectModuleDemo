/**
 * 하네스가 쓰는 수치. 값 옆에 근거를 남긴다.
 */

/**
 * dt 상한 0.1초 (= 10fps).
 *
 * 탭을 백그라운드에 두면 rAF가 멈췄다가 복귀 시 dt가 수십 초로 튄다.
 * 클램프가 없으면 그 한 프레임에서 모든 파티클이 수명을 다 소진하고,
 * gravity*dt 때문에 위치가 수백 미터 밖으로 날아간다.
 *
 * 0.1초를 고른 이유: 실제로 발생 가능한 최악의 정상 프레임(무거운 씬 전환, GC 정지)이
 * 대략 이 근처다. 이보다 낮게 잡으면 정상적인 저프레임 구간에서도 시뮬레이션이 느려진다.
 *
 * 고르지 않은 대안:
 *   - 고정 스텝 누적(accumulator + 최대 N substep): 시간 정확도는 오르지만 복귀 첫 프레임에
 *     substep이 몰려 CPU 스파이크가 나고, 그게 그대로 p95를 오염시킨다. 측정이 산출물인
 *     과제에서 측정을 망가뜨리는 최적화는 잘못된 선택이다.
 *   - 폭주 프레임 스킵: 정상적인 20fps 구간에서도 오작동한다.
 */
export const MAX_DT_SECONDS = 0.1

/**
 * 한 프레임에서 허용하는 최대 버스트 수.
 * dt 클램프 상한(0.1s) x 최대 부하의 초당 버스트 수를 넘지 않게 잡은 여유값이다.
 *
 *   최대 부하 2,048,000 / (수명 0.9s x 버스트당 24개) = 94,815 bursts/s
 *   94,815 x 0.1s(dt 상한) = 9,482 -> 여유를 두어 16,384
 *
 * 이 한도가 부하 상한과 같이 움직여야 하는 이유는 과부하 테스트의 성격 때문이다.
 * 부하가 걸리면 프레임이 길어지고, 프레임이 길어지면 프레임당 버스트 수가 오른다.
 * 상한을 안 올리면 정작 측정하려는 저프레임 구간에서만 발사가 잘려 목표 N에 도달하지 못하고,
 * "부하를 못 걸어서 빨랐다"가 "빨라서 부하를 못 걸었다"로 잘못 읽힌다.
 *
 * 이 한도에 걸리면 밀린 발사 빚은 탕감한다. 빚을 이월하면 다음 프레임이 더 밀리는 악순환이 된다.
 */
export const MAX_BURSTS_PER_FRAME = 16_384

/** 카메라 공통 파라미터. 두 씬이 같은 값을 쓰는 편이 씬 간 성능 비교를 공정하게 만든다. */
export const CAMERA_FOV_DEG = 60
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 200

/** DebugPanel에서 강제로 고를 수 있는 devicePixelRatio. null은 "기기 값 그대로". */
export const PIXEL_RATIO_OPTIONS: readonly (number | null)[] = [null, 1, 1.5, 2]

/** 하드웨어 DPR 상한. 4K + DPR 3 조합에서 프래그먼트 비용이 통제 불능이 된다. */
export const HARD_PIXEL_RATIO_CAP = 2

/** dt 폭주 검증 버튼이 주입하는 가짜 프레임 간격(초). */
export const DT_SPIKE_INJECTION_SECONDS = 5

/**
 * 이 값을 넘는 프레임 간격은 로그에 남긴다 (= 2fps 미만).
 * MAX_DT_SECONDS 자체를 임계로 쓰면 그냥 느린 기기에서 매 프레임 로그가 쏟아진다.
 * 5배로 잡으면 "정상적으로 느린 것"과 "탭이 멈췄다 돌아온 것"이 갈린다.
 */
export const DT_SPIKE_LOG_THRESHOLD_SECONDS = MAX_DT_SECONDS * 5

/** 절두체 밖 발생 검증: 카메라 뒤쪽 이 거리에 버스트를 만든다. */
export const BEHIND_CAMERA_DISTANCE = 40

/** 풀 고갈 검증에서 강제로 올리는 동시 파티클 목표치. capacity(5,120,000)를 확실히 넘겨야 한다. */
export const POOL_EXHAUST_TARGET = 10_240_000

/**
 * UI 갱신 주기(초). 4Hz.
 * 매 프레임 갱신하면 p95를 구하는 정렬과 DOM 텍스트 쓰기가 우리가 재려는 프레임 타임에 섞인다.
 * 계기가 측정 대상을 바꾸면 안 된다.
 */
export const UI_REFRESH_SECONDS = 0.25
