/**
 * Lightweight GoatCounter analytics — page views only, no session content.
 *
 * Privacy guarantees:
 * - Only initialized after explicit user consent
 * - Never sends prompt data, model names, conversation IDs, or session content
 * - Script loaded dynamically only when consent is granted
 * - Degrades silently if blocked by ad blockers or network issues
 * - Noop in shared viewer mode (contextlens.io)
 * - All calls wrapped in try/catch — never breaks the app
 */

const CONSENT_KEY = 'context-lens-analytics-consent'
const GOATCOUNTER_URL = 'https://contextlens.goatcounter.com/count'
const GOATCOUNTER_SCRIPT = 'https://gc.zgo.at/count.js'

type Consent = 'granted' | 'denied' | null

let enabled = false
let scriptLoaded = false
let pendingEvents: Array<{ path: string; event?: boolean }> = []

declare global {
  interface Window {
    goatcounter?: {
      count: (opts?: { path?: string; event?: boolean }) => void
      no_onload?: boolean
    }
  }
}

export function getAnalyticsConsent(): Consent {
  try {
    const val = window.localStorage.getItem(CONSENT_KEY)
    if (val === 'granted' || val === 'denied') return val
    return null
  } catch {
    return null
  }
}

export function setAnalyticsConsent(consent: 'granted' | 'denied'): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, consent)
  } catch {
    // Storage full or blocked
  }
  enabled = consent === 'granted'
  if (enabled) {
    loadScript()
  }
}

function loadScript(): void {
  if (scriptLoaded) return
  scriptLoaded = true
  try {
    // Tell GoatCounter not to auto-count the initial page load —
    // we send synthetic paths, not real URLs (which would leak session IDs).
    window.goatcounter = { no_onload: true } as typeof window.goatcounter
    const s = document.createElement('script')
    s.async = true
    s.src = GOATCOUNTER_SCRIPT
    s.dataset.goatcounter = GOATCOUNTER_URL
    // Script failing to load is fine — ad blocker, offline, etc.
    s.onerror = () => {
      enabled = false
      pendingEvents = []
    }
    s.onload = () => {
      flushPendingEvents()
    }
    document.head.appendChild(s)
  } catch {
    enabled = false
    pendingEvents = []
  }
}

function flushPendingEvents(): void {
  if (typeof window.goatcounter?.count !== 'function' || pendingEvents.length === 0) return
  const events = [...pendingEvents]
  pendingEvents = []
  for (const item of events) {
    try {
      window.goatcounter.count(item)
    } catch {
      // Ignore individual failures
    }
  }
}

/**
 * Initialize analytics. Call once on app mount.
 * Only loads the GoatCounter script if consent was previously granted.
 */
export function initAnalytics(): void {
  enabled = getAnalyticsConsent() === 'granted'
  if (enabled) {
    loadScript()
  }
}

/**
 * Track a page view. Path should be a synthetic route like
 * "dashboard", "inspector/overview", "export".
 *
 * Never include session IDs, model names, or user content in the path.
 */
export function trackPage(path: string): void {
  if (!enabled) return
  const syntheticPath = `/${path}`
  try {
    if (typeof window.goatcounter?.count === 'function') {
      window.goatcounter.count({ path: syntheticPath })
      return
    }
    if (scriptLoaded) {
      pendingEvents.push({ path: syntheticPath })
    }
  } catch {
    // Blocked, offline, or errored
  }
}

/**
 * Track a feature event as a virtual page view.
 * GoatCounter doesn't have custom events, so we use path prefixes.
 */
export function trackEvent(action: string): void {
  if (!enabled) return
  const syntheticPath = `/event/${action}`
  try {
    if (typeof window.goatcounter?.count === 'function') {
      window.goatcounter.count({ path: syntheticPath, event: true })
      return
    }
    if (scriptLoaded) {
      pendingEvents.push({ path: syntheticPath, event: true })
    }
  } catch {
    // Blocked, offline, or errored
  }
}
