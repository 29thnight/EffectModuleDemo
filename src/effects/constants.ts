import type { EffectStyle, ImpactBurstConfig } from './types'

/**
 * 하드코딩 금지 규칙에 따라 이펙트 모듈이 쓰는 모든 수치를 여기로 모은다.
 * "왜 이 값인가"를 값 옆에 남긴다 — 나중에 만지는 사람이 근거 없이 못 바꾸게.
 */

/**
 * 슬롯 5,120,000개.
 * 근거: 부하 스윕 최대 단계가 동시 2,048,000개이고, 링 버퍼는 죽었지만 아직 회수 안 된 슬롯이
 * draw 구간에 섞이므로 여유가 필요하다. 헤드리스 벤치에서 잰 draw/alive 비율은 낮은 단계에서
 * 1.34배로 안정적이지만 최상위 단계에서 1.81배까지 오른다(링이 배열 끝을 걸치는 프레임이
 * 측정 창에 들어가는 빈도가 부하에 따라 달라진다). 그 최악값에 여유를 얹어 2.5배로 잡았다.
 * 2,048,000 × 2.5 = 5,120,000.
 *
 * 비용: (위치 3 + 수명 1 + 시드 1) × 4바이트 × 5,120,000 = 102.4MB GPU 버퍼,
 * 여기에 CPU 전용 속도 3 + 나이 1 + 수명 1 = 102.4MB. 합계 약 205MB가 기동 시 한 번에 잡힌다.
 * 기본 부하(2,000)로만 쓰는 사람에게는 순수 낭비다 — 이 데모의 목적이 과부하 측정이라
 * 감수하는 비용이고, 모듈을 가져다 쓰는 쪽은 capacity를 자기 상한에 맞춰 낮춰야 한다.
 *
 * 이보다 낮게 잡으면 최상위 단계에서 recycle이 돌기 시작하고, 그 순간 "동시 N개를 유지한다"는
 * 측정 전제가 깨져 그 단계의 FPS는 다른 단계와 비교할 수 없는 숫자가 된다.
 */
export const DEFAULT_CAPACITY = 5_120_000

/**
 * 버스트당 24개.
 * 근거: 타격 이펙트로 눈에 보이는 최소 밀도이면서, 동시 500개 같은 낮은 단계에서도
 * 초당 버스트 수가 1 미만으로 떨어지지 않는 값. (500 / (0.9초 × 24) ≈ 23 bursts/s)
 */
export const DEFAULT_PARTICLES_PER_BURST = 24

/** 아무 의미 없는 32비트 상수(황금비 해시). 시드 값 자체는 중요하지 않고 "고정"인 것이 중요하다. */
export const DEFAULT_SEED = 0x9e3779b9

export const DEFAULT_EFFECT_CONFIG: ImpactBurstConfig = {
  capacity: DEFAULT_CAPACITY,
  particlesPerBurst: DEFAULT_PARTICLES_PER_BURST,
  overflow: 'recycle-oldest',
  seed: DEFAULT_SEED,
}

/**
 * 기본 스타일. 씬이 아무것도 선언하지 않아도 이 값으로 보인다.
 * 씬은 이 위에 자기가 신경 쓰는 항목만 덮어쓴다.
 */
export const DEFAULT_EFFECT_STYLE: EffectStyle = {
  colorCore: 0xffffff,
  colorEdge: 0xff7a2a,
  sizeStart: 0.13,
  sizeEnd: 0.02,
  lifetime: 0.9,
  lifetimeJitter: 0.35,
  speed: 6.5,
  speedJitter: 0.5,
  spreadRad: Math.PI * 0.42,
  gravity: -9.81,
  drag: 1.8,
  opacity: 1,
  blending: 'additive',
}

/** 파티클별 크기 편차: 시드 0~1 → 배율 0.6~1.4. 전부 같은 크기면 스프라이트 격자가 눈에 보인다. */
export const SIZE_SEED_MIN = 0.6
export const SIZE_SEED_RANGE = 0.8

/**
 * 최소 점 크기 1px.
 * 0으로 두면 멀리 있는 파티클이 서브픽셀로 깜빡인다(에일리어싱).
 * 1px로 바닥을 깔면 대신 아주 먼 파티클이 실제보다 커 보인다 — 깜빡임보다 이쪽이 낫다.
 */
export const MIN_POINT_SIZE_PX = 1

/** 수명 마지막 12% 구간에서 알파 페이드아웃. 0이면 파티클이 뚝 끊긴다. */
export const FADE_OUT_RATIO = 0.12

/** 파티클당 float 개수. 위치 3 + 속도 3 (속도는 CPU 전용). */
export const FLOATS_PER_VECTOR = 3

/** drag가 0에 가까울 때 exp() 호출을 건너뛰기 위한 임계값. */
export const DRAG_EPSILON = 1e-6

/** 수명 하한. lifetimeJitter가 1에 가까울 때 life가 0 이하로 내려가 0으로 나누는 것을 막는다. */
export const MIN_LIFETIME = 1e-3

/** 원뿔 분사 각도 상한. spreadRad가 PI를 넘으면 cos()가 되감겨 분포가 뒤집힌다. */
export const MAX_SPREAD_RAD = Math.PI
