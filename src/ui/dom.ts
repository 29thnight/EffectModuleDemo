/**
 * DOM 조립용 최소 헬퍼.
 *
 * 프레임워크를 넣지 않은 이유: 이 패널은 4Hz로 숫자 20여 개를 갱신하는 것이 전부다.
 * 가상 DOM diff는 그 일에 필요 없고, 의존성이 하나 늘면 "npm install 1회로 구동"의
 * 실패 지점이 하나 늘어난다. 과제의 하드 제약이 그 위험을 감수할 이유를 주지 않는다.
 */

type Attributes = Record<string, string>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value)
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', { type: 'button' }, [label])
  node.addEventListener('click', onClick)
  return node
}

/** 라벨 요소와 그 안의 input. 하네스가 상태를 바꾸거나 잠글 때 input에 직접 손대야 한다. */
export interface InputParts {
  readonly root: HTMLLabelElement
  readonly input: HTMLInputElement
}

/** 라디오 하나. 같은 name을 공유하면 브라우저가 배타 선택을 알아서 해준다. */
export function radio(
  name: string,
  value: string,
  label: string,
  checked: boolean,
  onSelect: (value: string) => void,
): InputParts {
  const input = el('input', { type: 'radio', name, value })
  input.checked = checked
  input.addEventListener('change', () => {
    if (input.checked) onSelect(value)
  })
  return { root: el('label', {}, [input, ' ', label]), input }
}

export type CheckboxParts = InputParts

/** input을 같이 돌려주는 이유: 하네스가 상태를 바꿨을 때(스윕이 자동 발사를 강제) 체크 표시를 따라오게 해야 한다. */
export function checkbox(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): CheckboxParts {
  const input = el('input', { type: 'checkbox' })
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))
  return { root: el('label', {}, [input, ' ', label]), input }
}

export function select(
  options: readonly { readonly value: string; readonly label: string }[],
  initialValue: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = el('select')
  for (const option of options) {
    node.append(el('option', { value: option.value }, [option.label]))
  }
  node.value = initialValue
  node.addEventListener('change', () => onChange(node.value))
  return node
}
