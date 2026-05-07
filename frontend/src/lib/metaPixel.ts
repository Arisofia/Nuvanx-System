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

function loadFbqStub(): void {
  if (globalThis.window === undefined) return
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
  if (globalThis.window === undefined) return
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
  if (!initialized || globalThis.window === undefined || !globalThis.fbq) return
  const opts = eventId ? { eventID: eventId } : undefined
  if (params && opts) globalThis.fbq('track', eventName, params, opts)
  else if (params) globalThis.fbq('track', eventName, params)
  else if (opts) globalThis.fbq('track', eventName, {}, opts)
  else globalThis.fbq('track', eventName)
}

export function getActiveMetaPixelId(): string | null {
  return activePixelId
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
