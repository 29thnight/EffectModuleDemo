import type { Object3D, Vector3 } from 'three'

/**
 * 이 파일은 "씬이 이펙트에 대해 알아야 할 전부"다.
 * 여기에 없는 것은 씬이 몰라야 하고, 실제로 알 수 없다.
 *
 * 의도적으로 노출하지 않는 것:
 *   ShaderMaterial / BufferGeometry / BufferAttribute / Float32Array /
 *   링 커서(head, span) / THREE.Points 인스턴스.
 * 이것들은 CPU 적분을 GPU 적분(TransformFeedback·GPGPU 텍스처)으로 갈아끼울 때
 * 통째로 사라지거나 형태가 바뀌는 것들이다. 공개하는 순간 교체가 파괴적 변경이 된다.
 */

/** 풀이 고갈됐을 때의 행동. 생성 시 고정 — 정책마다 슬롯 회수 경로가 달라 런타임 전환은 거짓말이 된다. */
export type OverflowPolicy = 'recycle-oldest' | 'drop-burst'

/** 합성 방식. 머티리얼 상태값이라 재컴파일 없이 런타임 변경 가능. */
export type BlendMode = 'additive' | 'normal'

/**
 * 층 1 — 생성 시 고정.
 * 전부 "바꾸면 GPU 버퍼를 다시 잡아야 하는" 값이다.
 * setter를 두면 프레임 중간에 재할당이 숨어버리므로, 타입 차원에서 잠근다.
 */
export interface ImpactBurstConfig {
  /** 파티클 슬롯 총량. 동시 생존 상한이자 VRAM 상한. */
  readonly capacity: number
  /** burst() 1회가 소비하는 슬롯 수. */
  readonly particlesPerBurst: number
  /** capacity를 넘겼을 때의 행동. */
  readonly overflow: OverflowPolicy
  /** 난수 시드. 같은 시드 → 같은 파티클 분포 → 측정 재현 가능. */
  readonly seed: number
}

/**
 * 층 2 — 런타임 변경 가능.
 * 전부 유니폼 또는 CPU 적분 계수로 흡수되며, 버퍼를 건드리지 않는다.
 */
export interface EffectStyle {
  /** 스프라이트 중심 색 (0xRRGGBB, sRGB). */
  readonly colorCore: number
  /** 스프라이트 외곽 색 (0xRRGGBB, sRGB). */
  readonly colorEdge: number
  /** 생성 시점 월드 크기(미터). */
  readonly sizeStart: number
  /** 소멸 시점 월드 크기(미터). */
  readonly sizeEnd: number
  /** 기준 수명(초). */
  readonly lifetime: number
  /** 수명 편차 비율 0~1. 0이면 버스트 전체가 동시에 사라진다. */
  readonly lifetimeJitter: number
  /** 초기 속력(m/s). */
  readonly speed: number
  /** 속력 편차 비율 0~1. */
  readonly speedJitter: number
  /** 분사 원뿔의 반각(radian). Math.PI면 전방향. */
  readonly spreadRad: number
  /** y축 가속도(m/s²). 아래로 떨어뜨리려면 음수. */
  readonly gravity: number
  /** 지수 감쇠 계수(1/s). 매 스텝 exp(-drag*dt)가 속도에 곱해진다. */
  readonly drag: number
  /** 최대 알파 0~1. */
  readonly opacity: number
  /** 합성 방식. */
  readonly blending: BlendMode
}

/** 씬은 스타일 전체를 알 필요가 없다. 자기가 신경 쓰는 항목만 선언한다. */
export type EffectStylePatch = Readonly<Partial<EffectStyle>>

/**
 * "어디서 터지는가".
 * 필드는 readonly지만 Vector3 내용은 호출자가 채운다(target-fill).
 * 매 버스트마다 Vector3 2개를 새로 만들면 초당 수백 개의 쓰레기가 생기고,
 * 그 GC가 그대로 p95 프레임 타임에 찍힌다. 측정이 목적인 과제에서 이건 치명적이라
 * 전역 불변성 규칙보다 무할당을 우선했다.
 */
export interface EmitPoint {
  readonly position: Vector3
  readonly direction: Vector3
}

/**
 * 관측값. 매 프레임 읽혀도 할당이 없도록 모듈은 단일 객체를 재사용해 돌려준다.
 * 스냅샷이 필요하면 호출자가 복사한다.
 */
export interface EffectStats {
  readonly capacity: number
  /** 실제로 살아있는 파티클 수. */
  readonly aliveCount: number
  /** 링에서 draw 대상으로 잡힌 슬롯 수(죽은 슬롯 포함). 정점 셰이더 비용의 근거. */
  readonly drawnSlots: number
  /** 이 이펙트가 유발한 드로우 콜. 항상 0(그릴 게 없음) 또는 1. */
  readonly drawCalls: number
  /** 직전 update()의 CPU 적분 시간(ms). */
  readonly cpuUpdateMs: number
  readonly burstsRequested: number
  readonly burstsDropped: number
  readonly particlesRecycled: number
  readonly disposed: boolean
}

/**
 * 씬이 잡는 손잡이. 씬은 object3D 하나만 쓰고 나머지는 하네스가 쓴다.
 * object3D의 타입이 Points가 아니라 Object3D인 것이 핵심이다 —
 * 구현이 Points든 Mesh(인스턴싱)든 Group이든 씬 코드는 그대로다.
 */
export interface EffectModule {
  readonly object3D: Object3D
  burst(point: EmitPoint): void
  setStyle(patch: EffectStylePatch): void
  update(dt: number): void
  /** 드로잉 버퍼 크기(px). 월드 크기를 화면 픽셀로 환산할 때 필요. 하네스만 호출한다. */
  setViewport(widthPx: number, heightPx: number): void
  readonly stats: EffectStats
  dispose(): void
}
