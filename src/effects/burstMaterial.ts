import { AdditiveBlending, Color, NormalBlending, ShaderMaterial, SRGBColorSpace } from 'three'

import { FADE_OUT_RATIO, MIN_POINT_SIZE_PX, SIZE_SEED_MIN, SIZE_SEED_RANGE } from './constants'
import { IMPACT_BURST_FRAGMENT, IMPACT_BURST_VERTEX } from './shaders'
import type { EffectStyle } from './types'

/**
 * 머티리얼과 유니폼. ImpactBurst에서 떼어낸 이유는 ParticleBuffers와 같다 —
 * "런타임 스타일이 어디로 흘러 들어가는가"를 한 파일에서 다 볼 수 있게 하려는 것이다.
 *
 * EffectStyle의 13개 항목이 전부 여기(유니폼 또는 머티리얼 상태) 아니면
 * CPU 적분 계수(gravity/drag/speed/lifetime/spread)로 흡수된다는 것이
 * "런타임 변경 가능"이라는 주장의 실제 근거다. 버퍼를 건드리는 항목은 하나도 없다.
 */
/**
 * interface가 아니라 type인 것은 취향이 아니다.
 * ShaderMaterial의 uniforms는 인덱스 시그니처(`{ [k: string]: IUniform }`)를 요구하는데,
 * TypeScript는 type 별칭에만 암시적 인덱스 시그니처를 부여하고 interface에는 부여하지 않는다.
 * interface로 두면 `as any` 캐스트가 필요해지고, 그 순간 유니폼 오타를 타입이 못 잡는다.
 */
export type BurstUniforms = {
  uColorCore: { value: Color }
  uColorEdge: { value: Color }
  uSizeStart: { value: number }
  uSizeEnd: { value: number }
  uOpacity: { value: number }
  uViewportHeight: { value: number }
  uSizeSeedMin: { value: number }
  uSizeSeedRange: { value: number }
  uMinPointSize: { value: number }
  uFadeOutRatio: { value: number }
}

export interface BurstMaterialBundle {
  readonly material: ShaderMaterial
  readonly uniforms: BurstUniforms
}

export function createBurstMaterial(): BurstMaterialBundle {
  const uniforms: BurstUniforms = {
    uColorCore: { value: new Color() },
    uColorEdge: { value: new Color() },
    uSizeStart: { value: 0 },
    uSizeEnd: { value: 0 },
    uOpacity: { value: 1 },
    uViewportHeight: { value: 1 },
    uSizeSeedMin: { value: SIZE_SEED_MIN },
    uSizeSeedRange: { value: SIZE_SEED_RANGE },
    uMinPointSize: { value: MIN_POINT_SIZE_PX },
    uFadeOutRatio: { value: FADE_OUT_RATIO },
  }

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: IMPACT_BURST_VERTEX,
    fragmentShader: IMPACT_BURST_FRAGMENT,
    transparent: true,
    // 파티클끼리 깊이를 쓰면 그리는 순서에 따라 서로를 잘라먹는다. 읽기만 하고 쓰지 않는다.
    depthWrite: false,
    depthTest: true,
  })

  return { material, uniforms }
}

/**
 * 런타임 스타일을 GPU 쪽에 반영한다.
 * blending은 GL 상태값이라 셰이더 재컴파일이 없다 — 그래서 런타임 층에 넣을 수 있었다.
 * 반대로 "가산/일반을 파티클마다 다르게" 같은 요구는 머티리얼이 하나뿐인 한 불가능하고,
 * 그걸 하려면 드로우 콜이 2회가 된다. 그건 이 모듈의 하드 제약과 충돌한다.
 */
export function applyStyleToMaterial(
  bundle: BurstMaterialBundle,
  style: EffectStyle,
): void {
  const { material, uniforms } = bundle
  uniforms.uColorCore.value.setHex(style.colorCore, SRGBColorSpace)
  uniforms.uColorEdge.value.setHex(style.colorEdge, SRGBColorSpace)
  uniforms.uSizeStart.value = style.sizeStart
  uniforms.uSizeEnd.value = style.sizeEnd
  uniforms.uOpacity.value = style.opacity
  material.blending = style.blending === 'additive' ? AdditiveBlending : NormalBlending
}
