import { createIcons, icons } from 'lucide'

// Re-scan the DOM for [data-lucide] placeholders after each view render so that
// dynamically-injected markup gets its icons swapped in.
export function refreshIcons() {
  createIcons({ icons, attrs: { 'stroke-width': 2 } })
}
