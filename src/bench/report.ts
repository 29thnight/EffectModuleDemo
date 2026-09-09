import { TARGET_REACHED_RATIO, VSYNC_CPU_HEADROOM_RATIO, VSYNC_FLATNESS_RATIO } from './constants'
import type { SweepReport, SweepStepResult } from './LoadSweep'

/**
 * 스윕 결과를 마크다운 표로 만든다.
 *
 * 텍스트로 뽑는 이유: 이 표는 README에 그대로 붙여넣기 위한 것이다.
 * 차트로 그리면 보기엔 좋지만 남이 자기 기기에서 돌린 결과와 나란히 놓고 비교할 수 없다.
 * 디자인은 평가 대상이 아니고, 재현 가능한 숫자는 평가 대상이다.
 */

const MS = (value: number): string => value.toFixed(2)
const INT = (value: number): string => Math.round(value).toLocaleString()

const COLUMNS: readonly string[] = [
  '목표 N',
  '실측 생존',
  'draw 슬롯',
  'bursts/s',
  'FPS',
  '프레임 avg',
  '프레임 p95',
  'CPU 프레임 avg',
  'CPU 프레임 p95',
  '이펙트 CPU avg',
  '이펙트 CPU p95',
  '드롭',
  '재활용',
]

export function formatSweepReport(report: SweepReport): string {
  // header는 이미 개행으로 끝난다. 마크다운 표 앞에는 빈 줄이 하나 더 있어야 표로 렌더된다.
  return `${formatHeader(report)}\n${formatTable(report.steps)}\n\n${diagnose(report)}\n`
}

function formatHeader(report: SweepReport): string {
  const c = report.context
  return [
    '# 부하 스윕 결과',
    '',
    `- 측정 시각: ${report.startedAt}`,
    `- 씬: ${c.sceneLabel}`,
    `- 뷰포트: ${c.viewportWidth} x ${c.viewportHeight} px @ DPR ${c.pixelRatio}`,
    `- 풀 용량: ${INT(c.capacity)} / 버스트당 ${c.particlesPerBurst}개 / 오버플로 ${c.overflow}`,
    `- 파티클 수명 L = ${c.lifetimeSeconds}s`,
    '- 정의: 동시 N개 = 정상 상태 생존 파티클 수. burstsPerSecond = N / (L x P)',
    `- 단계마다 워밍업 ${report.warmupSeconds}s 후 ${report.measureSeconds}s 측정`,
    '',
  ].join('\n')
}

function formatTable(steps: readonly SweepStepResult[]): string {
  const rows = steps.map((step) =>
    [
      INT(step.targetConcurrent),
      INT(step.aliveAvg),
      INT(step.drawnSlotsAvg),
      step.burstsPerSecond.toFixed(1),
      step.fps.toFixed(1),
      MS(step.frameAvgMs),
      MS(step.frameP95Ms),
      MS(step.cpuFrameAvgMs),
      MS(step.cpuFrameP95Ms),
      MS(step.effectAvgMs),
      MS(step.effectP95Ms),
      INT(step.burstsDropped),
      INT(step.particlesRecycled),
    ].join(' | '),
  )

  return [
    `| ${COLUMNS.join(' | ')} |`,
    `| ${COLUMNS.map(() => '---:').join(' | ')} |`,
    ...rows.map((row) => `| ${row} |`),
  ].join('\n')
}

/**
 * 숫자를 해석까지 해서 붙인다.
 * 표만 던져놓으면 "그래서 다음에 뭘 고칠 건데"가 남지 않는다.
 */
function diagnose(report: SweepReport): string {
  const last = report.steps[report.steps.length - 1]
  if (!last) return '## 해석\n\n측정된 단계가 없습니다.'

  const gpuGap = last.frameAvgMs - last.cpuFrameAvgMs
  const effectShare = last.cpuFrameAvgMs > 0 ? (last.effectAvgMs / last.cpuFrameAvgMs) * 100 : 0

  return [
    '## 해석',
    '',
    `- 최대 부하(동시 ${INT(last.targetConcurrent)}개)에서 프레임 avg ${MS(last.frameAvgMs)}ms / p95 ${MS(last.frameP95Ms)}ms`,
    `- 그중 우리 JS가 ${MS(last.cpuFrameAvgMs)}ms, 이펙트 CPU 적분이 ${MS(last.effectAvgMs)}ms (CPU 시간의 ${effectShare.toFixed(0)}%)`,
    `- 프레임 - CPU 간극 ${MS(gpuGap)}ms`,
    `- 병목 판정: ${pickBottleneck(last, gpuGap, effectShare)}`,
  ].join('\n')
}

function pickBottleneck(last: SweepStepResult, gpuGap: number, effectShare: number): string {
  // 목표 미달을 가장 먼저 걸러낸다. 여기에 걸리면 아래 판정은 전부 무의미하다 —
  // 재려던 부하가 애초에 걸리지 않았으므로 병목을 논할 대상 자체가 없다.
  if (last.aliveAvg < last.targetConcurrent * TARGET_REACHED_RATIO) {
    const reached = last.targetConcurrent > 0 ? (last.aliveAvg / last.targetConcurrent) * 100 : 0
    return (
      `목표 미달(${INT(last.aliveAvg)} / ${INT(last.targetConcurrent)}, ${reached.toFixed(0)}%). ` +
      '프레임이 dt 클램프보다 길어져 정상 상태에 도달하기 전에 측정이 끝났다. ' +
      '이 행의 프레임 타임은 목표 N이 아니라 실측 생존 수의 성능이므로 다른 단계와 비교할 수 없다. ' +
      '직전 단계까지를 유효 구간으로 읽어야 한다.'
    )
  }

  // vsync 고정을 그다음에 걸러낸다.
  // 프레임 타임이 주사율에 딱 붙어 흔들리지 않는데 CPU가 그 안에 넉넉히 들어간다면,
  // GPU가 포화된 것이 아니라 화면을 기다리는 중이다. 즉 아직 한계를 못 찾은 것이지
  // "GPU 병목"이 아니다. 이 둘을 뭉뚱그리면 "60fps 나왔으니 됐다"고 잘못 읽게 된다.
  const isFlat = last.frameP95Ms <= last.frameAvgMs * VSYNC_FLATNESS_RATIO
  const hasHeadroom = last.cpuFrameAvgMs < last.frameAvgMs * VSYNC_CPU_HEADROOM_RATIO
  if (isFlat && hasHeadroom) {
    const hz = last.frameAvgMs > 0 ? (1000 / last.frameAvgMs).toFixed(0) : '?'
    return (
      `vsync 고정(약 ${hz}Hz). 이 부하 범위에서는 한계에 도달하지 못했다 — ` +
      '진짜 상한을 보려면 부하를 더 올리거나 vsync를 꺼야 한다.'
    )
  }
  if (gpuGap > last.cpuFrameAvgMs) {
    return 'GPU(프래그먼트 오버드로우)가 프레임을 지배한다. CPU는 아직 여유가 있다.'
  }
  if (effectShare > 50) {
    return '이펙트 CPU 적분. 이 시점부터 GPU 적분(TransformFeedback / GPGPU 텍스처) 전환이 근거를 갖는다.'
  }
  return 'CPU이지만 이펙트 밖. 씬 업데이트나 드로우 콜 제출 쪽을 먼저 봐야 한다.'
}
