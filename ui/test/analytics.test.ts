import { beforeEach, describe, expect, it, vi } from 'vitest'

type ScriptStub = {
  async: boolean
  src: string
  dataset: Record<string, string>
  onload: null | (() => void)
  onerror: null | (() => void)
}

function setupDom() {
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
  }

  const appended: ScriptStub[] = []
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'script') throw new Error(`Unexpected tag: ${tag}`)
    const script: ScriptStub = {
      async: false,
      src: '',
      dataset: {},
      onload: null,
      onerror: null,
    }
    return script
  })

  const document = {
    createElement,
    head: {
      appendChild: vi.fn((node: ScriptStub) => {
        appended.push(node)
      }),
    },
  }

  const windowObj: Record<string, unknown> = {
    localStorage,
    goatcounter: undefined,
  }

  Object.assign(globalThis, {
    window: windowObj,
    document,
  })

  return {
    storage,
    localStorage,
    appended,
    windowObj,
  }
}

describe('analytics utils', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    // Ensure a clean global each test
    delete (globalThis as any).window
    delete (globalThis as any).document
  })

  it('reads and writes consent', async () => {
    const { storage } = setupDom()
    const analytics = await import('@/utils/analytics')

    expect(analytics.getAnalyticsConsent()).toBeNull()

    analytics.setAnalyticsConsent('granted')
    expect(storage.get('context-lens-analytics-consent')).toBe('granted')
    expect(analytics.getAnalyticsConsent()).toBe('granted')

    analytics.setAnalyticsConsent('denied')
    expect(storage.get('context-lens-analytics-consent')).toBe('denied')
    expect(analytics.getAnalyticsConsent()).toBe('denied')
  })

  it('does not track when consent was not granted', async () => {
    setupDom()
    const analytics = await import('@/utils/analytics')

    const count = vi.fn()
    ;(globalThis as any).window.goatcounter = { count }

    analytics.initAnalytics()
    analytics.trackPage('dashboard')
    analytics.trackEvent('export')

    expect(count).not.toHaveBeenCalled()
  })

  it('loads GoatCounter script when consent is granted', async () => {
    const { appended } = setupDom()
    const analytics = await import('@/utils/analytics')

    analytics.setAnalyticsConsent('granted')

    expect(appended).toHaveLength(1)
    expect(appended[0].src).toBe('https://gc.zgo.at/count.js')
    expect(appended[0].dataset.goatcounter).toBe('https://contextlens.goatcounter.com/count')
  })

  it('queues and flushes track calls after script onload', async () => {
    const { appended, windowObj } = setupDom()
    const analytics = await import('@/utils/analytics')

    analytics.setAnalyticsConsent('granted')
    expect(appended).toHaveLength(1)

    // Calls happen before GoatCounter is available
    analytics.trackPage('dashboard')
    analytics.trackEvent('export')

    const count = vi.fn()
    ;(windowObj as any).goatcounter = { count }

    appended[0].onload?.()

    expect(count).toHaveBeenCalledTimes(2)
    expect(count).toHaveBeenNthCalledWith(1, { path: '/dashboard' })
    expect(count).toHaveBeenNthCalledWith(2, { path: '/event/export', event: true })
  })

  it('disables tracking when script fails to load', async () => {
    const { appended, windowObj } = setupDom()
    const analytics = await import('@/utils/analytics')

    analytics.setAnalyticsConsent('granted')
    analytics.trackPage('dashboard') // queued before load

    appended[0].onerror?.()

    const count = vi.fn()
    ;(windowObj as any).goatcounter = { count }

    analytics.trackPage('inspector/overview')
    expect(count).not.toHaveBeenCalled()
  })

  it('handles localStorage failures without throwing', async () => {
    setupDom()
    const analytics = await import('@/utils/analytics')

    ;(globalThis as any).window.localStorage.getItem = vi.fn(() => {
      throw new Error('blocked')
    })
    ;(globalThis as any).window.localStorage.setItem = vi.fn(() => {
      throw new Error('blocked')
    })

    expect(analytics.getAnalyticsConsent()).toBeNull()
    expect(() => analytics.setAnalyticsConsent('granted')).not.toThrow()
  })
})
