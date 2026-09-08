import type { Object3D, PerspectiveCamera, Scene, ToneMapping } from 'three'

import type { EffectStylePatch, EmitPoint, OverflowPolicy } from '../effects/types'

export type SceneId = 'indoor' | 'outdoor'

/**
 * 씬이 "나는 이런 렌더 상태에서 보여야 한다"를 선언한다. 적용은 하네스가 한다.
 *
 * 씬이 renderer를 직접 만지지 않는 이유: WebGL 컨텍스트는 하나뿐이고 전역 상태다.
 * 두 씬이 각자 renderer.toneMapping을 쓰기 시작하면 "누가 마지막에 썼는가"가
 * 화면을 결정하게 되어, 씬 전환 순서에 따라 그림이 달라진다.
 * 선언으로 바꾸면 전환 시점 한 곳에서만 상태가 바뀌고 순서 의존이 사라진다.
 */
export interface RendererProfile {
  readonly clearColor: number
  readonly toneMapping: ToneMapping
  readonly toneMappingExposure: number
  /** 이 씬에서 허용할 devicePixelRatio 상한. 밝은 야외 씬은 오버드로우가 커서 더 낮게 잡는다. */
  readonly maxPixelRatio: number
}

/**
 * 씬이 이펙트에 대해 아는 것은 정확히 세 가지다.
 *   1) attachEffects  - "scene.add(effects.object3D)" 한 줄. 두 씬에서 문자 그대로 동일하다.
 *   2) getEmitPoint   - "어디서 터지는가". 좌표와 방향만 돌려준다.
 *   3) effectStyle    - "어떻게 보여야 하는가". 선언만 하고 적용하지 않는다.
 *
 * update()와 dispose()에는 이펙트 관련 코드가 한 줄도 없다. 이것이 이 인터페이스의 존재 이유다.
 */
export interface SceneModule {
  readonly id: SceneId
  readonly label: string
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly rendererProfile: RendererProfile

  /** 선언만. 하네스가 씬 활성화 시점에 effects.setStyle()로 적용한다. */
  readonly effectStyle: EffectStylePatch

  /** 씬이 이펙트를 붙이는 유일한 접점. 인자 타입이 Object3D인 것이 계약의 핵심이다. */
  attachEffects(effectRoot: Object3D): void

  /**
   * "어디서 터지는가". 하네스가 넘긴 target을 채워서 그대로 돌려준다.
   * 새 객체를 만들지 않는 이유는 effects/types.ts의 EmitPoint 주석에 있다.
   */
  getEmitPoint(target: EmitPoint): EmitPoint

  update(dt: number, elapsed: number): void
  resize(width: number, height: number): void
  dispose(): void
}

/**
 * UI로 넘어가는 관측값. THREE 타입이 하나도 없다.
 * DebugPanel은 이 타입만 import 하므로 UI 코드는 three를 전혀 모른다.
 * (반대로 core는 ui를 import 하지 않는다. 의존 방향은 ui -> core 한쪽뿐이다.)
 */
export interface FrameTelemetry {
  readonly sceneId: SceneId
  readonly sceneLabel: string

  /** rAF 콜백 간격 기준. vsync 대기와 GPU 시간이 전부 들어간 "진짜 프레임 타임". */
  readonly frameAvgMs: number
  readonly frameP95Ms: number
  readonly fps: number

  /** 우리 JS가 실제로 돈 시간(씬 update + 이펙트 update + draw 제출). */
  readonly cpuFrameAvgMs: number
  readonly cpuFrameP95Ms: number

  /** 그중 이펙트 CPU 적분만 분리한 시간. */
  readonly effectAvgMs: number
  readonly effectP95Ms: number

  readonly targetConcurrent: number
  readonly burstsPerSecond: number
  readonly aliveCount: number
  readonly drawnSlots: number
  readonly capacity: number
  readonly effectDrawCalls: number
  readonly totalDrawCalls: number
  readonly burstsDropped: number
  readonly particlesRecycled: number

  readonly overflow: OverflowPolicy
  readonly pixelRatio: number
  /**
   * 씬 전환 이후 관측된 최대 dt와 그 클램프 결과.
   *
   * "마지막 프레임의 dt"도 "직전 0.25초 구간의 최대"도 안 된다. 둘 다 다음 갱신에
   * 곧바로 덮어써져서, 정작 클램프가 일한 순간을 사람이 화면에서 볼 수 없다.
   * 검증 항목은 눈에 남아 있어야 검증이다. 그래서 최댓값을 붙잡아 둔다.
   */
  readonly maxRawDtMs: number
  readonly maxClampedDtMs: number
  readonly effectDisposed: boolean
  readonly emitBehindCamera: boolean
}

/** 하네스가 노출하는 조작 표면. main.ts가 이걸 DebugPanel에 배선한다. */
export type ProbeKind = 'dt-spike' | 'dispose-then-call' | 'pool-exhaust' | 'reset-load'
