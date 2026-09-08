import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three'

import { FLOATS_PER_VECTOR } from './constants'

/**
 * 파티클 슬롯의 저장소. 시뮬레이션 로직은 여기 없다.
 *
 * ImpactBurst에서 떼어낸 이유는 줄 수가 아니라 교체 단위 때문이다.
 * CPU 적분을 GPU 적분으로 옮기면 바뀌는 것이 정확히 이 클래스다 —
 * velocities/ages/lifespans는 사라지고 그 자리에 부동소수점 텍스처 두 장이 들어온다.
 * 링 커서와 적분식(ImpactBurst)은 그대로 남는다. 바뀔 것과 안 바뀔 것을 파일로 갈라 뒀다.
 *
 * GPU로 올라가는 것과 CPU에만 있는 것을 필드 이름이 아니라 주석으로 구분해 둔다.
 * 이걸 헷갈리면 "왜 위치는 반영되는데 속도는 셰이더에서 안 보이지" 같은 시간 낭비가 생긴다.
 */
export class ParticleBuffers {
  readonly geometry: BufferGeometry

  /** GPU로 올라간다. */
  readonly positions: Float32Array
  readonly lifeRatios: Float32Array
  readonly seeds: Float32Array

  /** CPU에만 있다. 셰이더는 이 셋의 존재를 모른다. */
  readonly velocities: Float32Array
  readonly ages: Float32Array
  readonly lifespans: Float32Array

  private readonly capacity: number
  private readonly positionAttr: BufferAttribute
  private readonly lifeAttr: BufferAttribute
  private readonly seedAttr: BufferAttribute

  constructor(capacity: number) {
    this.capacity = capacity

    this.positions = new Float32Array(capacity * FLOATS_PER_VECTOR)
    this.lifeRatios = new Float32Array(capacity)
    this.seeds = new Float32Array(capacity)
    this.velocities = new Float32Array(capacity * FLOATS_PER_VECTOR)
    this.ages = new Float32Array(capacity)
    this.lifespans = new Float32Array(capacity)

    this.positionAttr = new BufferAttribute(this.positions, FLOATS_PER_VECTOR)
    this.lifeAttr = new BufferAttribute(this.lifeRatios, 1)
    this.seedAttr = new BufferAttribute(this.seeds, 1)
    for (const attr of [this.positionAttr, this.lifeAttr, this.seedAttr]) {
      attr.setUsage(DynamicDrawUsage)
    }

    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', this.positionAttr)
    this.geometry.setAttribute('aLife', this.lifeAttr)
    this.geometry.setAttribute('aSeed', this.seedAttr)
    this.geometry.setDrawRange(0, 0)
  }

  setDrawRange(start: number, count: number): void {
    this.geometry.setDrawRange(start, count)
  }

  get drawnSlots(): number {
    return this.geometry.drawRange.count
  }

  /**
   * 링 위의 [start, start+count) 구간만 GPU에 올린다.
   * 구간이 배열 끝을 넘으면 두 조각으로 쪼갠다 — three가 조각들을 정렬·병합해 준다.
   *
   * @param includeSeeds 시드는 생성 시에만 바뀌므로 버스트가 있었던 프레임에만 true로 준다.
   */
  markUpload(start: number, count: number, includeSeeds: boolean): void {
    if (count <= 0) return

    const firstCount = Math.min(count, this.capacity - start)
    const secondCount = count - firstCount

    this.addRange(this.positionAttr, start, firstCount, FLOATS_PER_VECTOR)
    this.addRange(this.lifeAttr, start, firstCount, 1)
    if (includeSeeds) this.addRange(this.seedAttr, start, firstCount, 1)

    if (secondCount > 0) {
      this.addRange(this.positionAttr, 0, secondCount, FLOATS_PER_VECTOR)
      this.addRange(this.lifeAttr, 0, secondCount, 1)
      if (includeSeeds) this.addRange(this.seedAttr, 0, secondCount, 1)
    }
  }

  dispose(): void {
    this.geometry.dispose()
  }

  private addRange(
    attr: BufferAttribute,
    slotStart: number,
    slotCount: number,
    stride: number,
  ): void {
    if (slotCount <= 0) return
    // three는 업로드 직후 updateRanges를 스스로 비운다(WebGLAttributes.updateBuffer).
    // 그래서 여기서 clear 하지 않는다. 렌더가 건너뛴 프레임의 구간이 다음 프레임과 병합되어 살아남는다.
    attr.addUpdateRange(slotStart * stride, slotCount * stride)
    attr.needsUpdate = true
  }
}
