import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three'

import { CAMERA_FAR, CAMERA_FOV_DEG, CAMERA_NEAR } from '../core/constants'
import type { RendererProfile, SceneModule } from '../core/types'
import type { EffectStylePatch, EmitPoint } from '../effects/types'
import { createLcg, type Rng } from '../shared/rng'

import {
  OUTDOOR_BACKGROUND,
  OUTDOOR_EFFECT_STYLE,
  OUTDOOR_EMIT_AHEAD_RAD,
  OUTDOOR_EMIT_ANGLE_JITTER,
  OUTDOOR_EMIT_GROUND_Y,
  OUTDOOR_EMIT_RADIUS_JITTER,
  OUTDOOR_EMIT_SEED,
  OUTDOOR_GROUND_COLOR,
  OUTDOOR_GROUND_LIGHT_COLOR,
  OUTDOOR_GROUND_SIZE,
  OUTDOOR_HEMI_INTENSITY,
  OUTDOOR_LOOK_AHEAD_RAD,
  OUTDOOR_LOOK_HEIGHT,
  OUTDOOR_ORBIT_HEIGHT,
  OUTDOOR_ORBIT_RADIUS,
  OUTDOOR_ORBIT_SPEED,
  OUTDOOR_PROP_COLOR,
  OUTDOOR_PROP_COUNT,
  OUTDOOR_PROP_MAX_SIZE,
  OUTDOOR_PROP_MIN_SIZE,
  OUTDOOR_PROP_SPREAD,
  OUTDOOR_RENDERER_PROFILE,
  OUTDOOR_SKY_COLOR,
  OUTDOOR_SUN_COLOR,
  OUTDOOR_SUN_INTENSITY,
  OUTDOOR_SUN_POSITION,
} from './constants'
import { Disposables } from './Disposables'

/**
 * 씬 B — 밝은 야외, 카메라가 원형 궤도를 계속 돈다.
 *
 * 씬 A와 마찬가지로 update()에는 카메라 이동만 있고 이펙트 코드는 한 줄도 없다.
 * 카메라가 계속 움직이므로 이펙트는 매 프레임 다른 깊이/화면 면적으로 그려진다.
 * 정지 씬에서는 드러나지 않는 오버드로우 변동이 여기서 나온다.
 */
export class OutdoorScene implements SceneModule {
  readonly id = 'outdoor' as const
  readonly label = '씬 B · 밝은 야외 / 이동 카메라'
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly rendererProfile: RendererProfile = OUTDOOR_RENDERER_PROFILE
  readonly effectStyle: EffectStylePatch = OUTDOOR_EFFECT_STYLE

  private readonly disposables = new Disposables()
  private readonly rng: Rng = createLcg(OUTDOOR_EMIT_SEED)
  private readonly lookTarget = new Vector3()
  private orbitAngle = 0

  constructor() {
    this.scene.background = new Color(OUTDOOR_BACKGROUND)
    this.camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR)

    this.buildGround()
    this.buildProps()
    this.buildLights()
    this.placeCamera()
  }

  /** 계약 1 — 씬 A와 문자 그대로 동일한 한 줄. */
  attachEffects(effectRoot: Object3D): void {
    this.scene.add(effectRoot)
  }

  /** 계약 2 — 카메라 진행 방향 앞쪽 지면. 위로 솟구치는 먼지라 방향은 +Y. */
  getEmitPoint(target: EmitPoint): EmitPoint {
    const angle =
      this.orbitAngle + OUTDOOR_EMIT_AHEAD_RAD + this.rng.nextSigned() * OUTDOOR_EMIT_ANGLE_JITTER
    const radius = OUTDOOR_ORBIT_RADIUS + this.rng.nextSigned() * OUTDOOR_EMIT_RADIUS_JITTER

    target.position.set(Math.cos(angle) * radius, OUTDOOR_EMIT_GROUND_Y, Math.sin(angle) * radius)
    target.direction.set(0, 1, 0)
    return target
  }

  /** 카메라 이동만. 이펙트 관련 코드 없음. */
  update(_dt: number, elapsed: number): void {
    this.orbitAngle = elapsed * OUTDOOR_ORBIT_SPEED
    this.placeCamera()
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  /** 씬 A와 동일. 등록한 것만 회수하고 이펙트는 건드리지 않는다. */
  dispose(): void {
    this.disposables.disposeAll()
  }

  // -- 내부 -------------------------------------------------------------------

  private placeCamera(): void {
    const angle = this.orbitAngle
    this.camera.position.set(
      Math.cos(angle) * OUTDOOR_ORBIT_RADIUS,
      OUTDOOR_ORBIT_HEIGHT,
      Math.sin(angle) * OUTDOOR_ORBIT_RADIUS,
    )

    const lookAngle = angle + OUTDOOR_LOOK_AHEAD_RAD
    this.lookTarget.set(
      Math.cos(lookAngle) * OUTDOOR_ORBIT_RADIUS,
      OUTDOOR_LOOK_HEIGHT,
      Math.sin(lookAngle) * OUTDOOR_ORBIT_RADIUS,
    )
    this.camera.lookAt(this.lookTarget)
  }

  private buildGround(): void {
    const geometry = this.disposables.track(
      new PlaneGeometry(OUTDOOR_GROUND_SIZE, OUTDOOR_GROUND_SIZE),
    )
    const material = this.disposables.track(
      new MeshLambertMaterial({ color: OUTDOOR_GROUND_COLOR }),
    )
    const ground = new Mesh(geometry, material)
    ground.rotation.x = -Math.PI / 2
    this.scene.add(ground)
  }

  /**
   * 프롭은 지오메트리와 머티리얼을 하나만 만들어 90개 Mesh가 공유한다.
   * 드로우 콜은 90회로 늘지만 GPU 메모리와 dispose 대상은 1개다.
   * 인스턴싱을 쓰지 않은 이유: 여기는 배경이고, 배경을 최적화하면 이펙트 측정의 잡음이 줄어드는 게
   * 아니라 오히려 "씬이 가벼울 때만 통하는 수치"가 된다. 배경은 평범한 정도로 둔다.
   */
  private buildProps(): void {
    const geometry = this.disposables.track(new BoxGeometry(1, 1, 1))
    const material = this.disposables.track(new MeshLambertMaterial({ color: OUTDOOR_PROP_COLOR }))
    const sizeRange = OUTDOOR_PROP_MAX_SIZE - OUTDOOR_PROP_MIN_SIZE

    for (let i = 0; i < OUTDOOR_PROP_COUNT; i++) {
      const height = OUTDOOR_PROP_MIN_SIZE + this.rng.next() * sizeRange
      const width = OUTDOOR_PROP_MIN_SIZE + this.rng.next() * sizeRange
      const prop = new Mesh(geometry, material)
      prop.scale.set(width, height, width)
      prop.position.set(
        this.rng.nextSigned() * OUTDOOR_PROP_SPREAD,
        height / 2,
        this.rng.nextSigned() * OUTDOOR_PROP_SPREAD,
      )
      prop.rotation.y = this.rng.next() * Math.PI
      this.scene.add(prop)
    }

    // 프롭 배치에 난수를 썼으므로 발사 지점 난수열이 프롭 개수에 끌려가지 않도록 되돌린다.
    // 이게 없으면 OUTDOOR_PROP_COUNT를 바꿨을 때 이펙트 위치까지 통째로 달라져 측정 비교가 깨진다.
    this.rng.reset()
  }

  private buildLights(): void {
    this.scene.add(
      new HemisphereLight(OUTDOOR_SKY_COLOR, OUTDOOR_GROUND_LIGHT_COLOR, OUTDOOR_HEMI_INTENSITY),
    )
    const sun = new DirectionalLight(OUTDOOR_SUN_COLOR, OUTDOOR_SUN_INTENSITY)
    sun.position.set(...OUTDOOR_SUN_POSITION)
    this.scene.add(sun)
  }
}
