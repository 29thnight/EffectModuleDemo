import { Vector3 } from 'three'

/**
 * 단위 축 하나로부터 직교 기저를 만든다.
 *
 * src/shared/에 있는 이유가 중요하다.
 * 이 계산은 이펙트(분사 원뿔을 축 둘레로 펼칠 때)와 씬(벽 법선으로부터 벽면 위의 한 점을
 * 고를 때) 양쪽이 쓴다. 처음에는 effects/ 안에 있었는데, 그러면 씬이
 * `import { BASIS_FALLBACK_THRESHOLD } from '../effects/constants'`를 하게 된다.
 * 그 한 줄 때문에 "씬이 이펙트에 대해 아는 것은 세 가지뿐"이라는 이 과제의 핵심 주장이
 * 문자 그대로는 거짓이 된다. 공용 수학은 공용 자리로 옮기는 게 맞다.
 */

/**
 * 축과 거의 평행한 헬퍼 벡터를 피하기 위한 임계값.
 * |axis.x|가 이보다 작으면 X축을, 아니면 Y축을 헬퍼로 쓴다.
 * 평행한 벡터로 외적을 하면 길이 0이 나와 normalize()가 NaN을 뱉는다.
 */
export const BASIS_FALLBACK_THRESHOLD = 0.9

const HELPER_X = new Vector3(1, 0, 0)
const HELPER_Y = new Vector3(0, 1, 0)

/**
 * @param axis 정규화된 축. 호출자가 정규화 책임을 진다 (핫 루프에서 중복 normalize를 피하려고).
 * @param outU axis에 수직인 단위 벡터가 채워진다.
 * @param outV axis, outU 양쪽에 수직인 단위 벡터가 채워진다.
 */
export function buildOrthonormalBasis(axis: Vector3, outU: Vector3, outV: Vector3): void {
  const helper = Math.abs(axis.x) < BASIS_FALLBACK_THRESHOLD ? HELPER_X : HELPER_Y
  outU.copy(helper).cross(axis).normalize()
  outV.copy(axis).cross(outU)
}
