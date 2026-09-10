import {
  type Camera,
  type Intersection,
  Matrix3,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
} from 'three'

import type { EmitPoint } from '../effects/types'

/** 클릭 시점에 레이를 쏠 대상. 씬 전환 뒤에도 리스너를 다시 달지 않도록 매번 묻는다. */
export interface ClickTarget {
  readonly scene: Scene
  readonly camera: Camera
}

export interface ClickEmitterHooks {
  readonly target: () => ClickTarget
  /** 맞았다. point는 재사용 객체라 콜백 밖으로 들고 나가면 다음 클릭에 덮어써진다. */
  readonly onHit: (point: EmitPoint, hit: Intersection) => void
  /** 아무것도 안 맞았다(허공). 발사 여부는 호출자가 정한다. */
  readonly onMiss: () => void
}

/**
 * 캔버스 클릭 → scene.children 전체에 레이캐스트 → 맞은 지점과 법선을 EmitPoint로.
 *
 * 씬 계약(SceneModule)에 "맞출 수 있는 물체 목록"을 추가하지 않고 씬 그래프 전체를 쓴다.
 * 씬이 이펙트에 대해 아는 것을 3가지로 묶어 둔 상태를 유지하기 위해서다.
 * 대가는 씬에 붙은 모든 것이 후보가 된다는 것 — 조명은 raycast가 no-op이라 무관하고,
 * 이펙트 루트(Points)는 모듈 쪽에서 스스로 raycast를 끈다(ImpactBurst 생성자 참고).
 * 그 한 줄이 없으면 5,120,000 정점 순회가 클릭마다 돈다.
 *
 * 할당: intersectObjects는 결과 배열을 재사용하고, 좌표·행렬은 전부 필드다.
 * 클릭은 초당 수백 번 오지 않지만 렌더 루프와 같은 프레임에 섞이므로 같은 규칙을 지킨다.
 */
export class ClickEmitter {
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly normalMatrix = new Matrix3()
  private readonly hits: Intersection[] = []
  private readonly point: EmitPoint = {
    position: new Vector3(),
    direction: new Vector3(0, 1, 0),
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: ClickEmitterHooks,
  ) {
    canvas.addEventListener('pointerdown', this.handlePointerDown)
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    // 주 버튼만. 우클릭·휠클릭은 브라우저 기본 동작(메뉴, 자동 스크롤)에 맡긴다.
    if (event.button !== 0) return

    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    )

    const { scene, camera } = this.hooks.target()
    // 클릭은 프레임 사이에 온다. 렌더 루프가 멈춘 채(백그라운드 탭) 씬을 바꾸고 클릭하면
    // 새 씬의 메시 행렬이 아직 단위 행렬이라, 회전 전 지면(수직 평면)에 거리 0으로 맞는 것을 실측했다.
    // 렌더가 매 프레임 하는 일을 여기서 한 번 더 한다. 비용은 씬 노드 수(~100)에 비례한다.
    camera.updateMatrixWorld()
    scene.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, camera)
    this.hits.length = 0
    this.raycaster.intersectObjects(scene.children, true, this.hits)

    const hit = this.hits[0]
    if (!hit) {
      this.hooks.onMiss()
      return
    }
    this.fillEmitPoint(hit)
    this.hooks.onHit(this.point, hit)
  }

  private fillEmitPoint(hit: Intersection): void {
    const { position, direction } = this.point
    position.copy(hit.point)

    if (!hit.face) {
      // 면이 없는 물체(Line 등). 보는 쪽으로 튀게 한다.
      direction.copy(this.raycaster.ray.direction).negate()
      return
    }

    // face.normal은 물체 로컬 좌표다. 회전·비균등 스케일까지 반영하려면 법선 행렬이 필요하다.
    this.normalMatrix.getNormalMatrix(hit.object.matrixWorld)
    direction.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize()

    // 실내 씬의 벽은 BackSide 상자라 기하 법선이 방 바깥을 향한다.
    // 파편은 항상 보는 사람 쪽으로 튀어야 하므로 레이와 마주 보도록 뒤집는다.
    if (direction.dot(this.raycaster.ray.direction) > 0) direction.negate()
  }
}
