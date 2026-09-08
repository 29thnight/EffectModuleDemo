import type { FrameTelemetry } from './types'

/**
 * 하네스가 바깥으로 내보내는 세 갈래.
 *
 * App이 UI를 직접 부르지 않고 콜백만 받는 것이 "3D 코드가 UI를 알지 못하게"의 구현이다.
 * 전부 선택 사항이고 기본값은 무시(no-op)다 — 하네스는 UI 없이도 돌아야 한다.
 * 실제로 헤드리스 벤치(`npm run bench:cpu`)가 그 경로를 쓴다.
 */
export interface AppCallbacks {
  onTelemetry(telemetry: FrameTelemetry): void
  onLog(message: string): void
  onSweepProgress(message: string): void
}

const noop = (): void => {}

export function withCallbackDefaults(partial: Partial<AppCallbacks>): AppCallbacks {
  return {
    onTelemetry: partial.onTelemetry ?? noop,
    onLog: partial.onLog ?? noop,
    onSweepProgress: partial.onSweepProgress ?? noop,
  }
}
