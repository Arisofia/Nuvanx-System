import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  cleanup: undefined as undefined | (() => void),
  setters: [] as ReturnType<typeof vi.fn>[],
  canonicalSignal: undefined as AbortSignal | undefined,
  metadataSignal: undefined as AbortSignal | undefined,
  rpc: vi.fn(),
  invokeApi: vi.fn(),
}))

vi.mock('react', () => ({
  useState: (initialValue: unknown) => {
    const setter = vi.fn()
    harness.setters.push(setter)
    return [initialValue, setter]
  },
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect()
    harness.cleanup = typeof cleanup === 'function' ? cleanup : undefined
  },
}))

vi.mock('../src/lib/supabaseClient', () => ({
  supabase: {
    rpc: harness.rpc.mockImplementation(() => ({
      abortSignal: (signal: AbortSignal) => {
        harness.canonicalSignal = signal
        return Promise.resolve({ data: [], error: null })
      },
    })),
  },
}))

vi.mock('../src/lib/invokeApi', () => ({
  invokeApi: harness.invokeApi.mockImplementation(
    (_path: string, init?: { signal?: AbortSignal }) => {
      harness.metadataSignal = init?.signal
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('missing AbortSignal'))
          return
        }

        const abort = () => {
          const error = new Error('request aborted by lifecycle cleanup')
          error.name = 'AbortError'
          reject(error)
        }

        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort, { once: true })
      })
    },
  ),
}))

import { useLeads } from '../src/hooks/useLeads'

afterEach(() => {
  vi.useRealTimers()
})

describe('useLeads lifecycle cancellation', () => {
  it('aborts pending canonical/enrichment work and performs no state update after unmount', async () => {
    vi.useFakeTimers()
    harness.cleanup = undefined
    harness.setters.length = 0
    harness.canonicalSignal = undefined
    harness.metadataSignal = undefined
    harness.rpc.mockClear()
    harness.invokeApi.mockClear()

    useLeads()

    // useLeads defers its initial load with setTimeout(0). Run that timer and
    // allow the canonical RPC promise to resolve so the optional metadata call
    // is left deliberately pending.
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    expect(harness.rpc).toHaveBeenCalledTimes(1)
    expect(harness.invokeApi).toHaveBeenCalledTimes(1)
    expect(harness.canonicalSignal).toBeDefined()
    expect(harness.metadataSignal).toBeDefined()
    expect(harness.canonicalSignal?.aborted).toBe(false)
    expect(harness.metadataSignal?.aborted).toBe(false)
    expect(harness.cleanup).toBeTypeOf('function')

    const [setLeads, setLoading, setError] = harness.setters
    expect(setLeads).toBeDefined()
    expect(setLoading).toBeDefined()
    expect(setError).toBeDefined()

    // Loading/error reset happens before the requests start; leads must not be
    // mutated while enrichment is pending.
    expect(setLoading).toHaveBeenCalledTimes(1)
    expect(setLoading).toHaveBeenLastCalledWith(true)
    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenLastCalledWith(null)
    expect(setLeads).not.toHaveBeenCalled()

    const callsBeforeUnmount = harness.setters.map((setter) => setter.mock.calls.length)
    harness.cleanup?.()

    expect(harness.canonicalSignal?.aborted).toBe(true)
    expect(harness.metadataSignal?.aborted).toBe(true)

    // Flush the rejection produced by abort. The inactive context must return
    // before setLeads/setError and the finally block must not set loading=false.
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.setters.map((setter) => setter.mock.calls.length)).toEqual(callsBeforeUnmount)
  })
})
