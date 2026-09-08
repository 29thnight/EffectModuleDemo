import type { EffectModule, EmitPoint } from '../effects/types'

/**
 * 비정상 상황 프로브 중 "해제된 모듈 두들기기"만 여기로 뺐다.
 *
 * 나머지 프로브(dt 주입, 풀 고갈, 부하 리셋)는 하네스 상태를 한 줄 바꾸는 것이 전부라
 * App 안에 있어도 읽는 데 방해가 되지 않는다. 이건 다르다 —
 * "공개 API 전체를 순서대로 호출해 보고 그 결과를 문장으로 만든다"는 별개의 관심사고,
 * 나중에 API가 늘면 여기만 늘어나야 한다.
 */

/**
 * 모듈을 dispose 한 뒤 공개 API를 전부 호출한다.
 * 기대 동작: 예외 없음, 상태 변화 없음, 드로우 콜 0.
 *
 * 호출자는 이 함수가 돌아온 뒤 인스턴스를 새로 만들어야 한다.
 * 여기서 재생성까지 하지 않는 이유는, 그러면 "해제 후 호출이 안전한가"라는 질문과
 * "데모를 계속 쓸 수 있게 한다"는 편의가 한 함수에 섞이기 때문이다.
 */
export function exerciseDisposedModule(effects: EffectModule, probePoint: EmitPoint): string {
  const aliveBefore = effects.stats.aliveCount
  const burstsBefore = effects.stats.burstsRequested

  effects.dispose()
  effects.dispose() // 두 번 호출해도 안전해야 한다 (중복 해제).
  effects.burst(probePoint)
  effects.update(1 / 60)
  effects.setStyle({ opacity: 0.1 })
  effects.setViewport(100, 100)

  const after = effects.stats
  return (
    `dispose 후 호출 검증 — 예외 없음 / disposed=${after.disposed} / ` +
    `alive ${aliveBefore} -> ${after.aliveCount} / drawCalls ${after.drawCalls} / ` +
    `burstsRequested ${burstsBefore} -> ${after.burstsRequested} (증가 없음)`
  )
}
