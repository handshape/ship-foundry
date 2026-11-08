import './styles/main.css'
import { mountApp } from './app/shell.js'
import { initRouter } from './app/router.js'

const root = document.querySelector('#app')
mountApp(root)
initRouter(root)
