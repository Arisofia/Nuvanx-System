/**
 * Meta Pixel client-side helper.
 *
 * Loads the official Meta Pixel snippet on demand and exposes a small typed
 * surface (`initMetaPixel`, `trackMetaEvent`, `useMetaPageView`).
 *
 * The pixel ID is read from `import.meta.env.VITE_META_PIXEL_ID` so that it
 * stays out of the source tree. If the variable is empty/undefined the helper
 * is a no-op (useful for local dev to avoid polluting Meta with test events).
 *
 * Events fired here can be deduplicated against server-side CAPI events by
 * passing a stable `eventId` (Meta uses `eventID` on the client + `event_id`
 * on the server to merge them).
 */
import { useEffect } from 'react'
import { useLocation } from 'wouter'

type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  loaded: boolean
  version: string
  push: (...args: unknown[]) => void
}

declare global {
  // Augment globalThis so TS recognises fbq / _fbq.
  var fbq: FbqFn | undefined
  var _fbq: unknown
}

let initialized = false
let activePixelId: string | null = null
let seenInitialPageView = false
const isBrowser = (): boolean => typeof globalThis.window !== 'undefined'

function loadFbqStub(): void {
  if (!isBrowser()) return
  if (globalThis.fbq) return
  // Standard Meta Pixel bootstrap — keep behavior identical to the official snippet.
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args)
    else n.queue.push(args)
  } as FbqFn
  if (!globalThis._fbq) globalThis._fbq = n
  n.push = n
  n.loaded = true
  n.version = '2.0'
  n.queue = []
  globalThis.fbq = n
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)
}

/**
 * Initialise the Meta Pixel. Safe to call multiple times — only the first call
 * with a non-empty pixel id loads the snippet and emits the initial PageView.
 */
export function initMetaPixel(pixelId: string | undefined | null): void {
  if (initialized) return
  const id = (pixelId ?? '').trim()
  if (!id) return
  if (!isBrowser()) return
  loadFbqStub()
  globalThis.fbq?.('init', id)
  globalThis.fbq?.('track', 'PageView')
  initialized = true
  seenInitialPageView = true
  activePixelId = id
}

/**
 * Track a Meta Pixel event. Pass `eventId` to deduplicate against a CAPI
 * server-side event sharing the same identifier.
 */
export function trackMetaEvent(
  eventName: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (!initialized || !isBrowser() || !globalThis.fbq) return
  const opts = eventId ? { eventID: eventId } : undefined
  if (params && opts) globalThis.fbq('track', eventName, params, opts)
  else if (params) globalThis.fbq('track', eventName, params)
  else if (opts) globalThis.fbq('track', eventName, undefined, opts)
  else globalThis.fbq('track', eventName)
}

export function getActiveMetaPixelId(): string | null {
  return activePixelId
}

/**
 * Capture Meta click ID (fbclid) and browser ID (_fbp) for server-side CAPI.
 * Call this once on app mount or layout mount.
 */
export function useMetaContextCapture(): void {
  const [location] = useLocation()

  useEffect(() => {
    if (!isBrowser()) return

    // 1. Capture fbclid from URL
    const params = new URLSearchParams(window.location.search)
    const fbclid = params.get('fbclid')
    if (fbclid) {
      localStorage.setItem('nvx_fbclid', fbclid)
      // Also store timestamp of capture to build fbc later
      localStorage.setItem('nvx_fbclid_ts', String(Date.now()))
    }
  }, [location])
}

/**
 * Retrieve captured Meta context for inclusion in API payloads.
 */
export function getMetaContext(): { fbc: string | null; fbp: string | null } {
  if (!isBrowser()) return { fbc: null, fbp: null }

  // 1. Build fbc from fbclid and timestamp
  const fbclid = localStorage.getItem('nvx_fbclid')
  const ts = localStorage.getItem('nvx_fbclid_ts')
  let fbc = null
  if (fbclid) {
    const timestamp = ts ? Math.floor(Number(ts) / 1000) : Math.floor(Date.now() / 1000)
    fbc = `fb.1.${timestamp}.${fbclid}`
  }

  // 2. Read fbp from cookie
  const fbp = getCookie('_fbp')

  return { fbc, fbp }
}

function getCookie(name: string): string | null {
  if (globalThis.document === undefined) return null
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(';').shift() ?? null
  return null
}

/**
 * Hook that fires `PageView` whenever the wouter location changes. The first
 * PageView is already emitted by `initMetaPixel`, so we skip the initial mount
 * to avoid duplicating it.
 */
export function useMetaPageView(): void {
  const [location] = useLocation()
  useEffect(() => {
    if (!initialized) return
    if (!seenInitialPageView) {
      seenInitialPageView = true
      return
    }
    globalThis.fbq?.('track', 'PageView')
  }, [location])
}
