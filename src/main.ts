import { DEFAULT_LOAD_INDEX, LOAD_STEPS, SWEEP_RESTORE_INDEX } from './bench/constants'
import { formatSweepReport } from './bench/report'
import { App } from './core/App'
import { DEFAULT_AUTO_EMISSION, PIXEL_RATIO_OPTIONS } from './core/constants'
import { DEFAULT_EFFECT_CONFIG } from './effects/constants'
import { DebugPanel } from './ui/DebugPanel'

/**
 * 배선 담당. 여기가 App(3D)과 DebugPanel(UI)이 서로를 아는 유일한 지점이다.
 * App은 콜백만 받고, DebugPanel은 콜백만 넘긴다. 둘은 서로를 import 하지 않는다.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')
if (!canvas) {
  throw new Error('#viewport 캔버스를 찾지 못했습니다. index.html을 확인하세요.')
}

let panel: DebugPanel | null = null

const app = new App(canvas, {
  onTelemetry: (telemetry) => panel?.setTelemetry(telemetry),
  onLog: (message) => panel?.log(message),
  onSweepProgress: (message) => panel?.setSweepProgress(message),
})

panel = new DebugPanel(document.body, {
  scenes: app.sceneList,
  initialSceneId: app.activeSceneId,
  loadSteps: LOAD_STEPS,
  initialLoadIndex: DEFAULT_LOAD_INDEX,
  pixelRatioOptions: PIXEL_RATIO_OPTIONS,
  initialOverflow: DEFAULT_EFFECT_CONFIG.overflow,
  initialAutoEmission: DEFAULT_AUTO_EMISSION,
  onSceneChange: (id) => app.setScene(id),
  onLoadChange: (target) => app.setConcurrentTarget(target),
  onAutoEmissionChange: (enabled) => app.setAutoEmission(enabled),
  onOverflowChange: (policy) => app.setOverflowPolicy(policy),
  onPixelRatioChange: (value) => app.setPixelRatioOverride(value),
  onEmitBehindCameraChange: (enabled) => app.setEmitBehindCamera(enabled),
  onProbe: (kind) => app.runProbe(kind),
  onRunSweep: () => {
    void runSweep()
  },
})

app.setConcurrentTarget(LOAD_STEPS[DEFAULT_LOAD_INDEX])
app.start()
panel.log('준비 완료. 캔버스를 클릭하면 맞은 지점에서 터집니다. 부하 측정은 「자동 발사」를 켜세요.')

async function runSweep(): Promise<void> {
  const activePanel = panel
  if (!activePanel) return

  activePanel.setSweepBusy(true)
  try {
    const report = await app.runSweep()
    activePanel.setReport(formatSweepReport(report))
    activePanel.log(`스윕 완료 — ${report.steps.length}단계. 결과는 아래 표에 있습니다.`)
  } catch (error: unknown) {
    activePanel.log(`스윕 실패: ${toMessage(error)}`)
  } finally {
    // 스윕은 마지막 단계(최대 부하)에서 끝난다. 그대로 두면 사용자가 손대지도 않은 채
    // 최대 부하가 계속 돌아 화면이 무거워진다. 기본 단계로 되돌린다.
    app.setConcurrentTarget(LOAD_STEPS[SWEEP_RESTORE_INDEX])
    activePanel.setLoadIndex(SWEEP_RESTORE_INDEX)
    activePanel.setSweepBusy(false)
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류'
}

// Vite HMR로 이 모듈이 교체될 때 이전 인스턴스의 rAF 루프와 WebGL 컨텍스트를 회수한다.
// 없으면 저장할 때마다 루프가 하나씩 쌓여 프레임 타임 측정이 무의미해진다.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.dispose()
    panel?.dispose()
    panel = null
  })
}
