import { refreshIcons } from '../ui/icons.js'
import { flushCleanups } from './cleanup.js'
import { mainView } from '../views/main.js'
import { getHarness, runHarness, harnessIndexView } from '../harness/index.js'

// Hash routes. The app is a single page; the hash selects the active view.
//   #/                 -> main application
//   #/harness          -> index of all tuning harnesses
//   #/harness/:id      -> a single tuning harness
const routes = [
  { pattern: /^\/?$/, render: () => mainView() },
  { pattern: /^\/harness\/([\w-]+)$/, render: (m) => harnessRoute(m[1]) },
  { pattern: /^\/harness\/?$/, render: () => harnessIndexView() },
]

function harnessRoute(id) {
  const harness = getHarness(id)
  if (!harness) return notFoundView(`No harness named "${id}".`)
  return runHarness(harness)
}

function notFoundView(message) {
  const el = document.createElement('div')
  el.className = 'alert alert-error w-full max-w-md mx-auto mt-10'
  el.innerHTML = `<i data-lucide="alert-triangle" class="w-5 h-5 shrink-0"></i><span>${
    message ?? 'Page not found.'
  }</span>`
  return el
}

export function initRouter(root) {
  const outlet = root.querySelector('#outlet')

  const render = () => {
    flushCleanups() // tear down the previous view (render loops, WebGL)
    const hash = location.hash.replace(/^#/, '') || '/'
    for (const route of routes) {
      const match = hash.match(route.pattern)
      if (match) {
        const node = route.render(match)
        outlet.replaceChildren(node)
        refreshIcons()
        return
      }
    }
    outlet.replaceChildren(notFoundView())
    refreshIcons()
  }

  window.addEventListener('hashchange', render)
  render()
}
