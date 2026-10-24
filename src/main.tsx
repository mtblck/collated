import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerServiceWorker, startIncoming } from './lib/incoming'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// Before React: a share or a launch can be waiting already (#73).
startIncoming()
if (import.meta.env.PROD) registerServiceWorker()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
