import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { initMetaPixel } from './lib/metaPixel'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1,
  })
}

// Bootstraps the Meta Pixel (active: 1405503384615251 - Francisco Antonio Geraldo Lorenzo).
// Must match the server-side CAPI pixel for proper event deduplication (eventID ↔ event_id).
// No-op when the env variable is empty (safe for local dev).
initMetaPixel(import.meta.env.VITE_META_PIXEL_ID)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
