/**
 * 고정 시드 선형 합동 생성기(LCG).
 *
 * Math.random()을 쓰지 않는 이유: 부하 스윕을 두 번 돌렸을 때 파티클 분포가 달라지면
 * 프레임 타임 차이가 "코드 변경 때문"인지 "이번엔 파티클이 카메라에 더 가까웠기 때문"인지
 * 구분할 수 없다. 측정이 산출물인 과제에서 재현 불가능한 난수는 측정을 무의미하게 만든다.
 *
 * Numerical Recipes 계수(1664525 / 1013904223). 통계적 품질보다
 * "상태 4바이트, 곱셈 1회, 할당 0회"가 중요해서 골랐다.
 * 대안: mulberry32(품질↑, 연산 2배), xorshift128(상태 16바이트).
 * 파티클 분산에는 LCG 하위 비트 편향이 눈에 띄지 않아 가장 싼 것을 택했다.
 */

const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223
/** 2^32. >>> 0 로 만든 부호 없는 32비트를 [0,1)로 정규화한다. */
const UINT32_SPAN = 4294967296

export interface Rng {
  /** [0, 1) */
  next(): number
  /** [-1, 1) */
  nextSigned(): number
  /** 같은 시드로 되돌린다. 스윕 단계마다 호출해 단계 간 분포를 일치시킨다. */
  reset(): void
}

export function createLcg(seed: number): Rng {
  const initial = seed >>> 0
  let state = initial

  const next = (): number => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0
    return state / UINT32_SPAN
  }

  return {
    next,
    nextSigned: () => next() * 2 - 1,
    reset: () => {
      state = initial
    },
  }
}
