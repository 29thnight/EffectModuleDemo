import { ACESFilmicToneMapping, NoToneMapping } from 'three'

import type { EffectStylePatch } from '../effects/types'
import type { RendererProfile } from '../core/types'

/**
 * 두 씬의 모든 수치. 씬 파일 안에 숫자를 남기지 않는다.
 *
 * 씬을 "어두운 실내 + 정지"와 "밝은 야외 + 이동"으로 가른 이유는 취향이 아니다.
 * 이펙트 모듈의 재사용성을 실제로 시험하려면 씬이 이펙트에게 요구하는 것이 서로 충돌해야 한다:
 *   - 배경 밝기가 반대다  -> 가산 합성이 한쪽에서만 통한다 (블렌딩이 런타임 층에 있어야 하는 이유)
 *   - 카메라 거동이 반대다 -> 정지 씬은 오버드로우가 일정, 이동 씬은 매 프레임 달라진다
 *   - 톤매핑이 다르다     -> 셰이더가 색공간 청크를 제대로 include 했는지 드러난다
 * 두 씬이 비슷하면 "재사용 가능하다"는 주장이 검증되지 않는다.
 */

// ── 공통 ────────────────────────────────────────────────────────────────────

/** 씬이 이펙트 발사 지점을 고를 때 쓰는 시드. 스윕 재현성을 위해 씬도 고정 난수를 쓴다. */
export const INDOOR_EMIT_SEED = 0x1f2e3d4c
export const OUTDOOR_EMIT_SEED = 0x5a6b7c8d

// ── 씬 A: 어두운 실내 / 정지 카메라 ──────────────────────────────────────────

export const INDOOR_ROOM_WIDTH = 16
export const INDOOR_ROOM_HEIGHT = 7
export const INDOOR_ROOM_DEPTH = 22

export const INDOOR_WALL_COLOR = 0x2a2f38
export const INDOOR_FLOOR_COLOR = 0x1b1f26
export const INDOOR_PILLAR_COLOR = 0x3a4150
export const INDOOR_BACKGROUND = 0x05070b

export const INDOOR_AMBIENT_COLOR = 0x223044
export const INDOOR_AMBIENT_INTENSITY = 0.45
export const INDOOR_LAMP_COLOR = 0xffd9a0
/** 물리 기반 조명 단위(칸델라). three r155+ 기본값 기준이라 예전 예제보다 값이 크다. */
export const INDOOR_LAMP_INTENSITY = 90
export const INDOOR_LAMP_DISTANCE = 34
export const INDOOR_LAMP_POSITION: readonly [number, number, number] = [0, 5.6, 1]

export const INDOOR_PILLAR_SIZE: readonly [number, number, number] = [0.9, 7, 0.9]
export const INDOOR_PILLAR_POSITIONS: readonly (readonly [number, number])[] = [
  [-5.2, -6.5],
  [5.2, -6.5],
  [-5.2, 1.5],
  [5.2, 1.5],
]

export const INDOOR_CAMERA_POSITION: readonly [number, number, number] = [0, 1.8, 8.5]
export const INDOOR_CAMERA_TARGET: readonly [number, number, number] = [0, 1.9, -2]

/**
 * 타격 대상 면. [원점x, 원점y, 원점z, 법선x, 법선y, 법선z, 폭, 높이].
 * 벽/바닥에서 안쪽을 향해 튄다. 카메라가 고정이라 이 면들이 항상 화면 안에 있다.
 */
export const INDOOR_IMPACT_PANELS: readonly (readonly number[])[] = [
  [0, 2.4, -10.9, 0, 0, 1, 12, 3.4],
  [-7.9, 2.4, -3, 1, 0, 0, 10, 3.4],
  [7.9, 2.4, -3, -1, 0, 0, 10, 3.4],
  [0, 0.05, -3, 0, 1, 0, 11, 12],
]

export const INDOOR_RENDERER_PROFILE: RendererProfile = {
  clearColor: INDOOR_BACKGROUND,
  // 어두운 실내는 하이라이트가 거의 없어 톤매핑이 할 일이 없다. 끄면 파티클 코어가 더 또렷하다.
  toneMapping: NoToneMapping,
  toneMappingExposure: 1,
  maxPixelRatio: 2,
}

/** 어두운 배경 + 가산 합성. 불꽃은 배경보다 밝으므로 더하는 것이 물리적으로도 맞다. */
export const INDOOR_EFFECT_STYLE: EffectStylePatch = {
  colorCore: 0xfff3d0,
  colorEdge: 0xff5a12,
  sizeStart: 0.14,
  sizeEnd: 0.015,
  lifetime: 0.9,
  lifetimeJitter: 0.4,
  speed: 7,
  speedJitter: 0.55,
  spreadRad: Math.PI * 0.42,
  gravity: -9.81,
  drag: 1.9,
  opacity: 1,
  blending: 'additive',
}

// ── 씬 B: 밝은 야외 / 계속 이동 ──────────────────────────────────────────────

export const OUTDOOR_BACKGROUND = 0x9dc4e8
export const OUTDOOR_GROUND_SIZE = 260
export const OUTDOOR_GROUND_COLOR = 0x8fa06a
export const OUTDOOR_PROP_COLOR = 0xd9d2c4

export const OUTDOOR_SKY_COLOR = 0xbcd8f2
export const OUTDOOR_GROUND_LIGHT_COLOR = 0x6b7a4a
export const OUTDOOR_HEMI_INTENSITY = 2.2
export const OUTDOOR_SUN_COLOR = 0xfff4e0
export const OUTDOOR_SUN_INTENSITY = 2.6
export const OUTDOOR_SUN_POSITION: readonly [number, number, number] = [30, 40, 18]

export const OUTDOOR_PROP_COUNT = 90
export const OUTDOOR_PROP_MIN_SIZE = 0.6
export const OUTDOOR_PROP_MAX_SIZE = 3.4
export const OUTDOOR_PROP_SPREAD = 110

/** 카메라 궤도. 계속 이동하되 경계가 없어야 하므로 원형 경로를 쓴다. */
export const OUTDOOR_ORBIT_RADIUS = 26
export const OUTDOOR_ORBIT_HEIGHT = 3.2
/** rad/s. 0.18이면 약 35초에 한 바퀴 — 눈에 띄게 움직이되 멀미나지 않는 속도. */
export const OUTDOOR_ORBIT_SPEED = 0.18
/** 시선을 진행 방향 앞쪽으로 이만큼(rad) 앞서 둔다. 정면을 보며 달리는 느낌이 난다. */
export const OUTDOOR_LOOK_AHEAD_RAD = 0.55
export const OUTDOOR_LOOK_HEIGHT = 1.4

/** 발사 지점은 카메라 진행 방향 앞쪽 지면에 흩뿌린다. */
export const OUTDOOR_EMIT_AHEAD_RAD = 0.32
export const OUTDOOR_EMIT_RADIUS_JITTER = 9
export const OUTDOOR_EMIT_ANGLE_JITTER = 0.22
export const OUTDOOR_EMIT_GROUND_Y = 0.05

export const OUTDOOR_RENDERER_PROFILE: RendererProfile = {
  clearColor: OUTDOOR_BACKGROUND,
  // 밝은 야외는 하늘이 쉽게 클리핑된다. ACES로 하이라이트를 눌러준다.
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 1,
  /**
   * 실내보다 낮게 잡는다. 밝은 배경 위의 일반 합성 파티클은 알파 블렌딩 대상이 되어
   * 프래그먼트 비용이 실내(가산 + 어두운 배경)보다 크다. DPR 2에서 오버드로우가 먼저 무너진다.
   * 대가: 씬 간 FPS를 그대로 비교할 수 없다. 그래서 DebugPanel에 DPR 고정 옵션을 뒀다.
   */
  maxPixelRatio: 1.5,
}

/**
 * 밝은 배경 + 일반 합성.
 * 여기서 가산 합성을 쓰면 파티클이 배경보다 밝아질 수 없어 거의 안 보인다.
 * "합성 방식이 왜 런타임 층에 있어야 하는가"에 대한 답이 이 한 줄이다.
 */
export const OUTDOOR_EFFECT_STYLE: EffectStylePatch = {
  colorCore: 0xfdf6e8,
  colorEdge: 0x9c7b52,
  sizeStart: 0.3,
  sizeEnd: 0.75,
  lifetime: 1.4,
  lifetimeJitter: 0.45,
  speed: 3.2,
  speedJitter: 0.6,
  spreadRad: Math.PI * 0.3,
  gravity: -1.6,
  drag: 1.1,
  opacity: 0.55,
  blending: 'normal',
}
