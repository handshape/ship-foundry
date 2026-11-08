// SHARED SCHEMA-DRIVEN CONTROLS (SP-09).
//
// DaisyUI-styled, dependency-free builders so each per-aspect harness (SP-10)
// can be written as ~15 lines: declare a param schema, call paramControls, wire
// onPatch to api.patchConfig. The individual builders (slider/select/color/
// toggle/number) are also exported so a harness can hand-roll a control.
//
// A schema is an array of leaf specs:
//   { key, label, type: 'slider'|'select'|'color'|'toggle'|'number',
//     min?, max?, step?, int?, options? (for select), default? }
//
// paramControls(schema, value, { onPatch, path }) renders one control per entry.
// `value` is the current value of the object being edited (e.g. config.hull); a
// control reads its own value from value[key]. On change a control calls
// onPatch({ [key]: newValue }). Pass `path` (a dot-notation prefix such as
// 'texture.panelLines') to edit a nested sub-object: the emitted patch is nested
// accordingly — { texture: { panelLines: { enabled } } } — and the value is read
// from value resolved at that path. Keep it simple and predictable.

// --- small DOM helpers --------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

// A labelled row: an optional header (label + live value) above the control.
function row(label, control, header) {
  const wrap = el('div', 'form-control')
  if (label && header) {
    const head = el('div', 'label pb-1')
    head.append(el('span', 'label-text', label), el('span', 'label-text-alt text-right', ''))
    const val = head.lastChild
    wrap.appendChild(head)
    control.__setValueLabel = (v) => {
      val.textContent = typeof v === 'number' ? String(v) : v
    }
  }
  wrap.appendChild(control)
  return wrap
}

function formatNum(v) {
  return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : ''
}

// --- individual builders ------------------------------------------------------

// slider({ label, min, max, step, value, int?, onInput }) -> HTMLElement
export function slider({ label, min, max, step = 1, value, int = false, onInput }) {
  const input = el('input')
  input.type = 'range'
  input.className = 'range range-primary range-sm w-full'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)

  const wrap = row(label, input, true)
  const labelEl = wrap.querySelector('.label-text-alt')
  const show = () => (labelEl.textContent = int ? String(Math.round(Number(input.value))) : formatNum(Number(input.value)))
  show()
  input.addEventListener('input', () => {
    let v = Number(input.value)
    if (int) v = Math.round(v)
    show()
    onInput(v)
  })
  return wrap
}

// number({ label, min, max, step, value, onInput }) -> HTMLElement
export function number({ label, min, max, step = 1, value, onInput }) {
  const input = el('input')
  input.type = 'number'
  input.className = 'input input-bordered input-sm w-full'
  if (Number.isFinite(min)) input.min = String(min)
  if (Number.isFinite(max)) input.max = String(max)
  input.step = String(step)
  input.value = String(value)

  const wrap = row(label, input, true)
  const labelEl = wrap.querySelector('.label-text-alt')
  input.addEventListener('input', () => {
    const v = Number(input.value)
    labelEl.textContent = formatNum(v)
    onInput(v)
  })
  return wrap
}

// select({ label, options, value, onInput }) -> HTMLElement
// `options` is an array of values (strings/numbers) or { label, value } pairs.
export function select({ label, options, value, onInput }) {
  const input = el('select')
  input.className = 'select select-bordered select-sm w-full'
  for (const opt of options) {
    const { label: optLabel, value: optValue } =
      opt && typeof opt === 'object' ? opt : { label: opt, value: opt }
    const o = el('option', '', optLabel)
    o.value = String(optValue)
    if (String(optValue) === String(value)) o.selected = true
    input.appendChild(o)
  }
  const wrap = row(label, input, !!label)
  input.addEventListener('change', () => {
    // Restore a numeric option to a number so onPatch gets the right type.
    const match = options.find((o) => String((o && typeof o === 'object' ? o.value : o)) === input.value)
    const v = match && typeof match === 'object' ? match.value : match
    onInput(v)
  })
  return wrap
}

// color({ label, value, onInput }) -> HTMLElement
export function color({ label, value, onInput }) {
  const input = el('input')
  input.type = 'color'
  input.className = 'color-input color-input-bordered color-input-sm'
  input.value = String(value || '#888888')
  const wrap = row(label, input, !!label)
  input.addEventListener('input', () => onInput(input.value))
  return wrap
}

// toggle({ label, value, onInput }) -> HTMLElement  (DaisyUI switch)
export function toggle({ label, value, onInput }) {
  const input = el('input')
  input.type = 'checkbox'
  input.className = 'toggle toggle-primary toggle-sm'
  input.checked = !!value
  const wrap = el('label', 'flex items-center justify-between gap-3')
  wrap.append(el('span', 'label-text', label || ''), input)
  input.addEventListener('change', () => onInput(input.checked))
  return wrap
}

// --- generic schema-driven group ---------------------------------------------

// Read a (possibly nested) value at a dot-notation path from `value`.
function readAt(value, path) {
  if (!path) return value
  return path
    .split('.')
    .reduce((cur, key) => (cur != null ? cur[key] : undefined), value)
}

// Build a nested patch object for `key` under `path`, e.g. path='texture.panelLines',
// key='enabled' -> { texture: { panelLines: { enabled } } }.
function nestedPatch(path, key, value) {
  if (!path) return { [key]: value }
  const keys = path.split('.')
  let node = {}
  let cursor = node
  for (const k of keys) {
    cursor[k] = {}
    cursor = cursor[k]
  }
  cursor[key] = value
  return node
}

const BUILDERS = { slider, select, color, toggle, number }

// paramControls(schema, value, { onPatch, path }) -> HTMLElement
// Renders one control per schema entry and calls onPatch({ [key]: value }) on
// each change (nested under `path` when provided).
export function paramControls(schema, value, { onPatch, path = '' } = {}) {
  const group = el('div', 'space-y-4')
  const source = readAt(value, path)

  for (const spec of schema) {
    const builder = BUILDERS[spec.type]
    if (!builder) continue
    const current = source && source[spec.key] !== undefined ? source[spec.key] : spec.default
    const control = builder({
      label: spec.label,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      int: spec.int,
      options: spec.options,
      value: current,
      onInput: (v) => onPatch(nestedPatch(path, spec.key, v)),
    })
    group.appendChild(control)
  }
  return group
}
