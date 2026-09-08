import { type Vector2, WebGLRenderer } from 'three'

import { HARD_PIXEL_RATIO_CAP } from './constants'
import type { RendererProfile } from './types'

/**
 * 렌더러 생성과 씬별 프로필 적용.
 *
 * 자유 함수로 둔 이유: 여기 있는 것들은 상태를 갖지 않고, WebGLRenderer라는
 * 이미 상태 덩어리인 객체에 값을 밀어 넣기만 한다. 클래스를 하나 더 만들면
 * "누가 렌더러를 소유하는가"라는 질문이 하나 더 생기고, 답은 어차피 App이다.
 */

export interface ViewportSize {
  readonly width: number
  readonly height: number
}

/**
 * 캔버스 CSS 크기와 DPR을 렌더러에 반영하고 드로잉 버퍼 크기를 out에 채운다.
 * 이펙트는 월드 크기를 화면 픽셀로 환산해야 해서 드로잉 버퍼 크기를 알아야 하는데,
 * 그건 렌더러의 사정이지 씬의 사정이 아니라 하네스가 먹여준다.
 */
export function applyViewport(
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  profile: RendererProfile,
  override: number | null,
  out: Vector2,
): ViewportSize {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth)
  const height = Math.max(1, canvas.clientHeight || window.innerHeight)

  renderer.setPixelRatio(resolvePixelRatio(profile, override, window.devicePixelRatio || 1))
  renderer.setSize(width, height, false)
  renderer.getDrawingBufferSize(out)

  return { width, height }
}

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  return new WebGLRenderer({
    canvas,
    // 파티클은 알파 블렌딩으로 그려져 MSAA 이득이 거의 없는데 대역폭은 그대로 든다.
    // 측정 대상이 이펙트이므로 껐다. 배경 박스 모서리가 거칠어지는 건 감수한다(디자인은 평가 대상 아님).
    antialias: false,
    powerPreference: 'high-performance',
  })
}

export function applyRendererProfile(renderer: WebGLRenderer, profile: RendererProfile): void {
  renderer.setClearColor(profile.clearColor, 1)
  renderer.toneMapping = profile.toneMapping
  renderer.toneMappingExposure = profile.toneMappingExposure
}

/**
 * 명시적 오버라이드는 씬 프로필 상한을 무시한다.
 *
 * 두 씬의 DPR 상한이 다르면(2 vs 1.5) 씬 간 FPS를 그대로 비교할 수 없는데,
 * 오버라이드까지 프로필에 막히면 "같은 DPR로 맞춰서 비교한다"는 조작 자체가 불가능해진다.
 * 프로필은 기본값을 정하는 것이지 조작자를 막는 장치가 아니다.
 * 다만 하드웨어 상한만은 어떤 경우에도 넘지 않는다 — 4K + DPR 3에서 프래그먼트 비용이
 * 통제 불능이 되는 것은 조작자의 의도와 무관한 사고다.
 */
export function resolvePixelRatio(
  profile: RendererProfile,
  override: number | null,
  deviceRatio: number,
): number {
  if (override !== null) return Math.min(override, HARD_PIXEL_RATIO_CAP)
  return Math.min(deviceRatio, profile.maxPixelRatio, HARD_PIXEL_RATIO_CAP)
}
