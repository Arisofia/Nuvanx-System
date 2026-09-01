import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('AI route side-effect contract', () => {
  it('keeps route mount read-only and reserves POST operations for explicit handlers', () => {
    const source = read('../src/pages/AI.tsx')
    const effectStart = source.indexOf('useEffect(() => {')
    const effectEnd = source.indexOf('}, [])', effectStart)
    expect(effectStart).toBeGreaterThan(-1)
    expect(effectEnd).toBeGreaterThan(effectStart)

    const mountEffect = source.slice(effectStart, effectEnd)
    expect(mountEffect).toContain('handleFetchOutputs()')
    expect(mountEffect).toContain('handleFetchAiStatus()')
    expect(mountEffect).not.toContain('handleAnalyze()')
    expect(mountEffect).not.toContain('handleFetchSuggestions()')

    expect(source).toContain("invokeApi('/api/ai/analyze-campaign', { method: 'POST', body: {} })")
    expect(source).toContain("invokeApi('/api/ai/suggestions', { method: 'POST', body: {} })")
    expect(source).toContain('onClick={handleAnalyze}')
    expect(source).toContain('onClick={handleFetchSuggestions}')
  })
})
