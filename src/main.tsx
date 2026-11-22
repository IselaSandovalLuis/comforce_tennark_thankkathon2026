import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Reporting stays online in browsers that disallow service workers.
    })
  })
}
