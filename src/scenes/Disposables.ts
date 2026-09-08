interface Disposable {
  dispose(): void
}

/**
 * 씬이 만든 GPU 자원만 모아서 회수한다.
 *
 * scene.traverse()로 순회하며 지우는 흔한 방식을 쓰지 않는 이유가 정확히 이 과제의 핵심이다.
 * 순회 방식은 씬 그래프에 붙어 있는 모든 것을 지운다. 그런데 이펙트 루트도 그 순간
 * 씬 그래프에 붙어 있고, 이펙트는 씬 것이 아니라 하네스 것이다.
 * 순회로 지우면 씬 전환 때마다 남의 GPU 자원을 해제해버린다.
 *
 * 그래서 "내가 만든 것만 등록해서 내가 지운다"로 뒤집었다.
 * 등록하지 않은 것은 어떤 경우에도 이 클래스가 건드리지 않는다.
 */
export class Disposables {
  private readonly items: Disposable[] = []

  track<T extends Disposable>(item: T): T {
    this.items.push(item)
    return item
  }

  disposeAll(): void {
    for (const item of this.items) item.dispose()
    this.items.length = 0
  }
}
