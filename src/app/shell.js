import { refreshIcons } from '../ui/icons.js'

// Mounts the persistent app chrome (top navbar + theme toggle) and the #outlet
// that the router fills on each navigation.
export function mountApp(root) {
  root.innerHTML = `
  <div class="flex min-h-screen flex-col bg-base-200">
    <nav class="navbar bg-base-100 shadow-md z-10">
      <div class="navbar-start gap-2">
        <a href="#/" class="btn btn-ghost text-xl font-semibold gap-2">
          <i data-lucide="rocket" class="w-6 h-6"></i>
          <span>Ship Foundry</span>
        </a>
      </div>
      <div class="navbar-center">
        <ul class="menu menu-horizontal gap-1">
          <li><a href="#/">Main</a></li>
          <li><a href="#/harness">Harnesses</a></li>
        </ul>
      </div>
      <div class="navbar-end">
        <label class="swap swap-rotate btn btn-ghost btn-circle" title="Toggle theme">
          <input type="checkbox" id="sf-theme-toggle" />
          <i data-lucide="sun" class="w-5 h-5 swap-on"></i>
          <i data-lucide="moon" class="w-5 h-5 swap-off"></i>
        </label>
      </div>
    </nav>
    <main id="outlet" class="flex-1 p-4"></main>
  </div>
  `

  const toggle = root.querySelector('#sf-theme-toggle')
  const apply = (theme) => document.documentElement.setAttribute('data-theme', theme)
  const saved = localStorage.getItem('sf-theme')
  if (saved === 'light' || saved === 'dark') {
    apply(saved)
    if (toggle) toggle.checked = saved === 'light'
  }
  toggle?.addEventListener('change', () => {
    const theme = toggle.checked ? 'light' : 'dark'
    apply(theme)
    localStorage.setItem('sf-theme', theme)
  })

  refreshIcons()
}
