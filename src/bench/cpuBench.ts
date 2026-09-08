import { Vector3 } from 'three'

import { EmissionScheduler } from '../core/EmissionScheduler'
import { DEFAULT_EFFECT_CONFIG, DEFAULT_EFFECT_STYLE } from '../effects/constants'
import { ImpactBurst } from '../effects/ImpactBurst'
import type { EmitPoint } from '../effects/types'

import { LOAD_STEPS, MEASURE_SECONDS, REPORT_PERCENTILE, WARMUP_SECONDS } from './constants'

/**
 * 헤드리스 CPU 벤치. `npm run bench:cpu`
 *
 * 왜 따로 두는가:
 *   브라우저 스윕(LoadSweep)은 프레임 타임에 GPU와 vsync가 섞여 들어간다. 그건 실제 체감을
 *   재는 데는 맞지만, "CPU 적분 자체가 얼마나 드는가"를 기기/드라이버와 무관하게 비교하기는 어렵다.
 *   여기서는 GPU를 아예 빼고 고정 dt로 돌려 CPU 적분 비용만 남긴다.
 *
 * 이 파일이 돌아간다는 사실 자체가 계약 검증이기도 하다.
 * ImpactBurst의 CPU 경로에는 document도 window도 WebGL 컨텍스트도 필요 없다.
 * 브라우저 밖에서 실행되는 순간 "내부 구현을 갈아끼울 여지"가 말뿐이 아니게 된다.
 *
 * 주의: 여기 숫자에는 버퍼 업로드도 드로우 콜도 프래그먼트 비용도 없다.
 * 브라우저 스윕 결과와 나란히 놓고 "차이 = GPU 쪽 비용"으로 읽어야 한다.
 */

/**
 * 이 파일이 쓰는 Node 표면은 stdout 하나뿐이라 그것만 선언한다.
 * @types/node를 넣고 tsconfig의 types에 'node'를 추가하면 브라우저 코드에서도
 * process.env 같은 것이 타입상 통과해버린다. 그 구멍을 만들 만한 이유가 stdout 한 줄에는 없다.
 */
declare const process: { readonly stdout: { write(text: string): void } }

const FIXED_DT = 1 / 60
const ORIGIN = new Vector3(0, 0.05, 0)
const DIRECTION = new Vector3(0, 1, 0)

interface BenchRow {
  readonly targetConcurrent: number
  readonly aliveAvg: number
  readonly drawnAvg: number
  readonly cpuAvgMs: number
  readonly cpuP95Ms: number
  readonly cpuMaxMs: number
  readonly recycled: number
  readonly dropped: number
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

interface MeasureResult {
  readonly samples: readonly number[]
  readonly aliveAvg: number
  readonly drawnAvg: number
}

/** 측정 없이 프레임만 돌린다. 정상 상태에 도달시키는 용도. */
function advance(effect: ImpactBurst, scheduler: EmissionScheduler, emit: () => void, frames: number): void {
  for (let i = 0; i < frames; i++) {
    scheduler.tick(FIXED_DT, emit)
    effect.update(FIXED_DT)
  }
}

function measure(
  effect: ImpactBurst,
  scheduler: EmissionScheduler,
  emit: () => void,
  frames: number,
): MeasureResult {
  const samples: number[] = []
  let aliveSum = 0
  let drawnSum = 0

  for (let i = 0; i < frames; i++) {
    scheduler.tick(FIXED_DT, emit)
    effect.update(FIXED_DT)
    const stats = effect.stats
    samples.push(stats.cpuUpdateMs)
    aliveSum += stats.aliveCount
    drawnSum += stats.drawnSlots
  }

  return { samples, aliveAvg: aliveSum / frames, drawnAvg: drawnSum / frames }
}

function runStep(targetConcurrent: number): BenchRow {
  // 단계마다 인스턴스를 새로 만든다. 시드가 고정이라 모든 단계가 같은 난수열에서 출발한다.
  const effect = new ImpactBurst(DEFAULT_EFFECT_CONFIG, DEFAULT_EFFECT_STYLE)
  const scheduler = new EmissionScheduler()
  scheduler.setTarget(
    targetConcurrent,
    DEFAULT_EFFECT_STYLE.lifetime,
    DEFAULT_EFFECT_CONFIG.particlesPerBurst,
  )

  const point: EmitPoint = { position: ORIGIN.clone(), direction: DIRECTION.clone() }
  const emit = (): void => effect.burst(point)

  advance(effect, scheduler, emit, Math.ceil(WARMUP_SECONDS / FIXED_DT))

  const droppedBaseline = effect.stats.burstsDropped
  const recycledBaseline = effect.stats.particlesRecycled
  const result = measure(effect, scheduler, emit, Math.ceil(MEASURE_SECONDS / FIXED_DT))

  const stats = effect.stats
  const row: BenchRow = {
    targetConcurrent,
    aliveAvg: result.aliveAvg,
    drawnAvg: result.drawnAvg,
    cpuAvgMs: result.samples.reduce((a, b) => a + b, 0) / result.samples.length,
    cpuP95Ms: percentile(result.samples, REPORT_PERCENTILE),
    cpuMaxMs: Math.max(...result.samples),
    recycled: stats.particlesRecycled - recycledBaseline,
    dropped: stats.burstsDropped - droppedBaseline,
  }

  effect.dispose()
  return row
}

function formatTable(rows: readonly BenchRow[]): string {
  const header = [
    '| 목표 N | 실측 생존 | draw 슬롯 | 이펙트 CPU avg | p95 | max | 재활용 | 드롭 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  const body = rows.map(
    (r) =>
      `| ${r.targetConcurrent.toLocaleString()} | ${Math.round(r.aliveAvg).toLocaleString()} | ` +
      `${Math.round(r.drawnAvg).toLocaleString()} | ${r.cpuAvgMs.toFixed(3)} ms | ` +
      `${r.cpuP95Ms.toFixed(3)} ms | ${r.cpuMaxMs.toFixed(3)} ms | ` +
      `${r.recycled.toLocaleString()} | ${r.dropped.toLocaleString()} |`,
  )
  return [...header, ...body].join('\n')
}

const rows = LOAD_STEPS.filter((step) => step > 0).map(runStep)

process.stdout.write(
  [
    '# 헤드리스 CPU 적분 벤치 (GPU 제외)',
    '',
    `- 고정 dt: ${(FIXED_DT * 1000).toFixed(2)} ms (60fps 가정)`,
    `- 단계마다 워밍업 ${WARMUP_SECONDS}s 후 ${MEASURE_SECONDS}s 측정`,
    `- 용량 ${DEFAULT_EFFECT_CONFIG.capacity.toLocaleString()} / 버스트당 ${DEFAULT_EFFECT_CONFIG.particlesPerBurst}개 / 오버플로 ${DEFAULT_EFFECT_CONFIG.overflow}`,
    `- 수명 L = ${DEFAULT_EFFECT_STYLE.lifetime}s`,
    '',
    formatTable(rows),
    '',
  ].join('\n'),
)
