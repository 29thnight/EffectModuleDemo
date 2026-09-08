import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector3,
} from 'three'

import { CAMERA_FAR, CAMERA_FOV_DEG, CAMERA_NEAR } from '../core/constants'
import type { RendererProfile, SceneModule } from '../core/types'
import type { EffectStylePatch, EmitPoint } from '../effects/types'
import { buildOrthonormalBasis } from '../shared/basis'
import { createLcg, type Rng } from '../shared/rng'

import {
  INDOOR_AMBIENT_COLOR,
  INDOOR_AMBIENT_INTENSITY,
  INDOOR_BACKGROUND,
  INDOOR_CAMERA_POSITION,
  INDOOR_CAMERA_TARGET,
  INDOOR_EFFECT_STYLE,
  INDOOR_EMIT_SEED,
  INDOOR_FLOOR_COLOR,
  INDOOR_IMPACT_PANELS,
  INDOOR_LAMP_COLOR,
  INDOOR_LAMP_DISTANCE,
  INDOOR_LAMP_INTENSITY,
  INDOOR_LAMP_POSITION,
  INDOOR_PILLAR_COLOR,
  INDOOR_PILLAR_POSITIONS,
  INDOOR_PILLAR_SIZE,
  INDOOR_RENDERER_PROFILE,
  INDOOR_ROOM_DEPTH,
  INDOOR_ROOM_HEIGHT,
  INDOOR_ROOM_WIDTH,
  INDOOR_WALL_COLOR,
} from './constants'
import { Disposables } from './Disposables'

/**
 * 씬 A — 어두운 실내, 카메라 정지.
 *
 * 이 파일에서 확인할 것: update()와 dispose()에 이펙트 관련 코드가 한 줄도 없다.
 * 이펙트와의 접점은 attachEffects / getEmitPoint / effectStyle 셋뿐이다.
 */
export class IndoorScene implements SceneModule {
  readonly id = 'indoor' as const
  readonly label = '씬 A · 어두운 실내 / 정지 카메라'
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly rendererProfile: RendererProfile = INDOOR_RENDERER_PROFILE
  readonly effectStyle: EffectStylePatch = INDOOR_EFFECT_STYLE

  private readonly disposables = new Disposables()
  private readonly rng: Rng = createLcg(INDOOR_EMIT_SEED)
  private readonly planeU = new Vector3()
  private readonly planeV = new Vector3()
  private readonly normal = new Vector3()

  constructor() {
    this.scene.background = new Color(INDOOR_BACKGROUND)
    this.camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR)
    this.camera.position.set(...INDOOR_CAMERA_POSITION)
    this.camera.lookAt(new Vector3(...INDOOR_CAMERA_TARGET))

    this.buildRoom()
    this.buildPillars()
    this.buildLights()
  }

  /** 계약 1 — 두 씬에서 문자 그대로 동일한 한 줄. */
  attachEffects(effectRoot: Object3D): void {
    this.scene.add(effectRoot)
  }

  /** 계약 2 — "어디서 터지는가". 벽/바닥 패널을 골라 그 위의 한 점과 안쪽 법선을 준다. */
  getEmitPoint(target: EmitPoint): EmitPoint {
    const index = Math.min(
      INDOOR_IMPACT_PANELS.length - 1,
      Math.floor(this.rng.next() * INDOOR_IMPACT_PANELS.length),
    )
    const panel = INDOOR_IMPACT_PANELS[index]
    const [ox, oy, oz, nx, ny, nz, width, height] = panel

    this.normal.set(nx, ny, nz).normalize()
    buildOrthonormalBasis(this.normal, this.planeU, this.planeV)

    const u = this.rng.nextSigned() * 0.5 * width
    const v = this.rng.nextSigned() * 0.5 * height

    target.position.set(
      ox + this.planeU.x * u + this.planeV.x * v,
      oy + this.planeU.y * u + this.planeV.y * v,
      oz + this.planeU.z * u + this.planeV.z * v,
    )
    target.direction.copy(this.normal)
    return target
  }

  /** 정지 씬이라 움직일 것이 없다. 이펙트 코드가 없는 것은 물론이다. */
  update(_dt: number, _elapsed: number): void {}

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  /**
   * 씬이 만든 것만 회수한다.
   * 이펙트 루트를 여기서 detach 하지 않는 이유: 그것은 하네스 소유물이고,
   * 씬이 남의 자원 수명에 개입하기 시작하면 소유권 규칙이 그 자리에서 무너진다.
   */
  dispose(): void {
    this.disposables.disposeAll()
  }

  // -- 내부 -------------------------------------------------------------------

  private buildRoom(): void {
    // 셰이딩은 의도적으로 싼 것을 쓴다(Lambert). 병목이 씬이 아니라 이펙트여야 측정이 의미를 갖는다.
    const shellGeometry = this.disposables.track(
      new BoxGeometry(INDOOR_ROOM_WIDTH, INDOOR_ROOM_HEIGHT, INDOOR_ROOM_DEPTH),
    )
    const shellMaterial = this.disposables.track(
      new MeshLambertMaterial({ color: INDOOR_WALL_COLOR, side: BackSide }),
    )
    const shell = new Mesh(shellGeometry, shellMaterial)
    shell.position.y = INDOOR_ROOM_HEIGHT / 2
    this.scene.add(shell)

    const floorGeometry = this.disposables.track(
      new PlaneGeometry(INDOOR_ROOM_WIDTH, INDOOR_ROOM_DEPTH),
    )
    const floorMaterial = this.disposables.track(
      new MeshLambertMaterial({ color: INDOOR_FLOOR_COLOR }),
    )
    const floor = new Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    this.scene.add(floor)
  }

  private buildPillars(): void {
    const geometry = this.disposables.track(new BoxGeometry(...INDOOR_PILLAR_SIZE))
    const material = this.disposables.track(
      new MeshLambertMaterial({ color: INDOOR_PILLAR_COLOR }),
    )
    for (const [x, z] of INDOOR_PILLAR_POSITIONS) {
      const pillar = new Mesh(geometry, material)
      pillar.position.set(x, INDOOR_PILLAR_SIZE[1] / 2, z)
      this.scene.add(pillar)
    }
  }

  private buildLights(): void {
    this.scene.add(new AmbientLight(INDOOR_AMBIENT_COLOR, INDOOR_AMBIENT_INTENSITY))
    const lamp = new PointLight(INDOOR_LAMP_COLOR, INDOOR_LAMP_INTENSITY, INDOOR_LAMP_DISTANCE)
    lamp.position.set(...INDOOR_LAMP_POSITION)
    this.scene.add(lamp)
  }
}
