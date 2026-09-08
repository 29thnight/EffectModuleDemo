import { type Object3D, Points, Vector3 } from 'three'

import { buildOrthonormalBasis } from '../shared/basis'
import { createLcg, type Rng } from '../shared/rng'

import {
  applyStyleToMaterial,
  type BurstMaterialBundle,
  createBurstMaterial,
} from './burstMaterial'
import {
  DEFAULT_EFFECT_CONFIG,
  DEFAULT_EFFECT_STYLE,
  DRAG_EPSILON,
  FLOATS_PER_VECTOR,
  MAX_SPREAD_RAD,
  MIN_LIFETIME,
} from './constants'
import { ParticleBuffers } from './ParticleBuffers'
import type {
  EffectModule,
  EffectStats,
  EffectStyle,
  EffectStylePatch,
  EmitPoint,
  ImpactBurstConfig,
} from './types'

type MutableStats = { -readonly [K in keyof EffectStats]: EffectStats[K] }

/**
 * THREE.Points 1개 + 고정 링 버퍼. 드로우 콜은 항상 1회.
 *
 * -- 링 버퍼를 고른 이유와, 고르지 않은 대안 --------------------------------
 * 대안은 "살아있는 파티클을 배열 앞쪽으로 압축(swap-remove)"이었다.
 * 그쪽이 정점 비용을 O(alive)로 정확히 맞춰준다는 점에서 더 좋아 보인다.
 * 탈락 사유:
 *   (1) recycle-oldest 정책이 O(1)에서 O(n) 탐색으로 바뀐다. 압축은 생성 순서를
 *       뒤섞으므로 "가장 오래된 것"을 알려면 별도 정렬 구조가 필요하다.
 *   (2) 죽을 때마다 마지막 원소를 구멍으로 옮기므로 버퍼 쓰기가 임의 위치로 흩어진다.
 *       부분 업로드 구간이 조각나 오히려 전체 업로드로 회귀한다.
 * 대신 링의 약점(살아있는 구간에 죽은 슬롯이 섞임)은 두 가지로 상쇄했다:
 *   - drawRange를 매 프레임 [head, span)으로 좁힌다. 감기지 않은 동안 정점 비용이 O(span).
 *   - 죽은 슬롯은 정점 셰이더 첫 분기에서 클립 공간 밖으로 밀려 프래그먼트를 만들지 않는다.
 *
 * 남은 대가는 정직하게 적는다. 링이 배열 끝을 걸치는 프레임에는 drawRange를 두 조각으로
 * 나눌 수 없어 전체 용량을 그린다. 걸치는 시간 비율이 대략 span/capacity라서
 * 부하가 올라갈수록 평균 draw 슬롯이 용량 쪽으로 끌려간다. README에 실측치가 있다.
 * 이걸 피하려면 감긴 프레임만 드로우 콜 2회를 허용하면 되지만, "항상 1회"가 제약이라 택하지 않았다.
 *
 * 비용 모델:
 *   CPU 적분 O(span) / 정점 O(drawnSlots) / 프래그먼트 O(alive x 화면 면적)
 *
 * -- 적분 방식 --------------------------------------------------------------
 * 준음함수 오일러(속도 먼저, 그 다음 위치). 명시적 오일러보다 감쇠 상황에서 안정적이고
 * RK4보다 3배 싸다. 파티클은 서로 상호작용하지 않아 고차 정확도가 화면에 보이지 않는다.
 * 감쇠는 (1 - drag*dt) 근사가 아니라 exp(-drag*dt)를 쓴다. dt가 클램프 상한(0.1s)까지
 * 튀어도 속도가 음수로 뒤집히지 않는다.
 */
export class ImpactBurst implements EffectModule {
  /** 씬에 노출되는 유일한 3D 객체. 타입이 Points가 아니라 Object3D인 것이 요점이다. */
  readonly object3D: Object3D

  private readonly config: ImpactBurstConfig
  private readonly buffers: ParticleBuffers
  private readonly materialBundle: BurstMaterialBundle
  private readonly points: Points
  private readonly rng: Rng
  private readonly statsRecord: MutableStats

  private readonly axis = new Vector3()
  private readonly axisU = new Vector3()
  private readonly axisV = new Vector3()

  private style: EffectStyle
  private head = 0
  private span = 0
  private seedsDirty = false
  private isDisposed = false

  constructor(config: Partial<ImpactBurstConfig> = {}, style: EffectStylePatch = {}) {
    this.config = { ...DEFAULT_EFFECT_CONFIG, ...config }
    assertValidConfig(this.config)
    this.style = { ...DEFAULT_EFFECT_STYLE, ...style }

    const { capacity, seed } = this.config
    this.rng = createLcg(seed)
    this.buffers = new ParticleBuffers(capacity)
    this.materialBundle = createBurstMaterial()

    this.points = new Points(this.buffers.geometry, this.materialBundle.material)
    // 파티클 좌표는 월드 좌표다. 매 프레임 바운딩 스피어를 다시 구하는 비용(O(capacity))보다
    // 절두체 컬링을 끄는 편이 싸다. 화면 밖 파티클은 정점 셰이더에서만 비용을 낸다.
    this.points.frustumCulled = false
    this.points.matrixAutoUpdate = false
    this.points.updateMatrix()
    this.object3D = this.points

    this.statsRecord = {
      capacity,
      aliveCount: 0,
      drawnSlots: 0,
      drawCalls: 1,
      cpuUpdateMs: 0,
      burstsRequested: 0,
      burstsDropped: 0,
      particlesRecycled: 0,
      disposed: false,
    }

    applyStyleToMaterial(this.materialBundle, this.style)
  }

  /** 매 프레임 읽혀도 할당이 없도록 같은 객체를 돌려준다. */
  get stats(): EffectStats {
    return this.statsRecord
  }

  burst(point: EmitPoint): void {
    if (this.isDisposed) return

    const stats = this.statsRecord
    stats.burstsRequested++

    const { capacity, particlesPerBurst, overflow } = this.config
    const free = capacity - this.span

    if (free < particlesPerBurst) {
      if (overflow === 'drop-burst') {
        stats.burstsDropped++
        return
      }
      const evicted = particlesPerBurst - free
      this.head = (this.head + evicted) % capacity
      this.span -= evicted
      stats.particlesRecycled += evicted
    }

    this.buildBasis(point.direction)
    const cosSpread = Math.cos(Math.min(MAX_SPREAD_RAD, Math.max(0, this.style.spreadRad)))
    const base = this.head + this.span
    for (let i = 0; i < particlesPerBurst; i++) {
      this.spawn((base + i) % capacity, point.position, cosSpread)
    }
    this.span += particlesPerBurst
    this.seedsDirty = true
  }

  /**
   * 호출 순서 계약: 하네스는 반드시 burst() -> update() -> render() 순으로 돈다.
   * update()가 이번 프레임에 생성된 슬롯까지 포함해 업로드 구간을 잡기 때문이다.
   */
  update(dt: number): void {
    if (this.isDisposed || dt <= 0) return

    const started = performance.now()
    const { capacity } = this.config
    const style = this.style
    const gravityDt = style.gravity * dt
    const dragFactor = style.drag > DRAG_EPSILON ? Math.exp(-style.drag * dt) : 1

    // 업로드 구간은 head가 앞으로 밀리기 전 기준으로 잡는다.
    // 이번 프레임에 죽은 슬롯의 aLife=0 을 GPU에 못 올리면 링이 감겼을 때 유령 파티클이 남는다.
    const uploadStart = this.head
    const uploadCount = this.span

    const end = this.head + this.span
    const alive =
      end <= capacity
        ? this.integrateRun(this.head, end, dt, gravityDt, dragFactor)
        : this.integrateRun(this.head, capacity, dt, gravityDt, dragFactor) +
          this.integrateRun(0, end - capacity, dt, gravityDt, dragFactor)

    this.trimDeadHead()
    this.updateDrawRange()
    this.buffers.markUpload(uploadStart, uploadCount, this.seedsDirty)
    this.seedsDirty = false

    const stats = this.statsRecord
    stats.aliveCount = alive
    stats.drawnSlots = this.buffers.drawnSlots
    stats.cpuUpdateMs = performance.now() - started
  }

  setStyle(patch: EffectStylePatch): void {
    if (this.isDisposed) return
    this.style = { ...this.style, ...patch }
    applyStyleToMaterial(this.materialBundle, this.style)
  }

  setViewport(_widthPx: number, heightPx: number): void {
    if (this.isDisposed) return
    this.materialBundle.uniforms.uViewportHeight.value = Math.max(1, heightPx)
  }

  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true

    // 모듈이 만든 것은 모듈이 회수한다. 부모에서 스스로 빠지는 것까지 포함해서.
    this.points.removeFromParent()
    this.buffers.dispose()
    this.materialBundle.material.dispose()

    this.head = 0
    this.span = 0

    const stats = this.statsRecord
    stats.disposed = true
    stats.aliveCount = 0
    stats.drawnSlots = 0
    stats.drawCalls = 0
    stats.cpuUpdateMs = 0
  }

  // -- 내부 -------------------------------------------------------------------

  private integrateRun(
    start: number,
    end: number,
    dt: number,
    gravityDt: number,
    dragFactor: number,
  ): number {
    // 링 구간을 두 개의 연속 구간으로 쪼개 호출하므로 이 루프 안에는 나머지 연산이 없다.
    const { positions, velocities, ages, lifespans, lifeRatios } = this.buffers
    let alive = 0

    for (let slot = start; slot < end; slot++) {
      const life = lifespans[slot]
      if (life <= 0) continue

      const age = ages[slot] + dt
      if (age >= life) {
        lifespans[slot] = 0
        lifeRatios[slot] = 0
        continue
      }
      ages[slot] = age

      const v = slot * FLOATS_PER_VECTOR
      const vx = velocities[v] * dragFactor
      const vy = (velocities[v + 1] + gravityDt) * dragFactor
      const vz = velocities[v + 2] * dragFactor
      velocities[v] = vx
      velocities[v + 1] = vy
      velocities[v + 2] = vz

      positions[v] += vx * dt
      positions[v + 1] += vy * dt
      positions[v + 2] += vz * dt
      lifeRatios[slot] = 1 - age / life
      alive++
    }

    return alive
  }

  private spawn(slot: number, origin: Vector3, cosSpread: number): void {
    const rng = this.rng
    const style = this.style
    const { positions, velocities, ages, lifespans, lifeRatios, seeds } = this.buffers

    const cosTheta = 1 - rng.next() * (1 - cosSpread)
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
    const phi = rng.next() * Math.PI * 2
    const su = sinTheta * Math.cos(phi)
    const sv = sinTheta * Math.sin(phi)

    const speed = style.speed * (1 + style.speedJitter * rng.nextSigned())
    const life = Math.max(
      MIN_LIFETIME,
      style.lifetime * (1 + style.lifetimeJitter * rng.nextSigned()),
    )

    const v = slot * FLOATS_PER_VECTOR
    positions[v] = origin.x
    positions[v + 1] = origin.y
    positions[v + 2] = origin.z
    velocities[v] = (this.axis.x * cosTheta + this.axisU.x * su + this.axisV.x * sv) * speed
    velocities[v + 1] = (this.axis.y * cosTheta + this.axisU.y * su + this.axisV.y * sv) * speed
    velocities[v + 2] = (this.axis.z * cosTheta + this.axisU.z * su + this.axisV.z * sv) * speed

    ages[slot] = 0
    lifespans[slot] = life
    lifeRatios[slot] = 1
    seeds[slot] = rng.next()
  }

  private buildBasis(direction: Vector3): void {
    this.axis.copy(direction)
    if (this.axis.lengthSq() < DRAG_EPSILON) this.axis.set(0, 1, 0)
    else this.axis.normalize()

    buildOrthonormalBasis(this.axis, this.axisU, this.axisV)
  }

  private trimDeadHead(): void {
    const { capacity } = this.config
    const { lifespans } = this.buffers
    while (this.span > 0 && lifespans[this.head] <= 0) {
      this.head = (this.head + 1) % capacity
      this.span--
    }
  }

  private updateDrawRange(): void {
    const { capacity } = this.config
    const end = this.head + this.span
    // 감기지 않았으면 살아있는 구간만, 감겼으면 전체. 어느 쪽이든 드로우 콜은 1회다.
    if (end <= capacity) this.buffers.setDrawRange(this.head, this.span)
    else this.buffers.setDrawRange(0, capacity)
  }
}

/** 시스템 경계 검증. 잘못된 설정은 조용히 잘리지 않고 즉시 실패한다. */
function assertValidConfig(config: ImpactBurstConfig): void {
  const { capacity, particlesPerBurst } = config
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(`ImpactBurst: capacity는 1 이상의 정수여야 합니다 (받은 값: ${capacity})`)
  }
  if (!Number.isInteger(particlesPerBurst) || particlesPerBurst <= 0) {
    throw new RangeError(
      `ImpactBurst: particlesPerBurst는 1 이상의 정수여야 합니다 (받은 값: ${particlesPerBurst})`,
    )
  }
  if (particlesPerBurst > capacity) {
    throw new RangeError(
      `ImpactBurst: particlesPerBurst(${particlesPerBurst})가 capacity(${capacity})보다 큽니다. ` +
        '버스트 한 번을 담지 못하는 풀은 어떤 오버플로 정책으로도 구제할 수 없습니다.',
    )
  }
}
