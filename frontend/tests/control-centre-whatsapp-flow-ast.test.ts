import { readFileSync } from 'node:fs'
import { parse } from '@typescript-eslint/parser'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

type AstNode = {
  type: string
  range?: [number, number]
  [key: string]: unknown
}

function ast(source: string, jsx = false): AstNode {
  return parse(source, {
    sourceType: 'module',
    ecmaVersion: 'latest',
    jsx,
    range: true,
  }) as unknown as AstNode
}

function children(node: AstNode): AstNode[] {
  const result: AstNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'range' || key === 'loc' || key === 'tokens' || key === 'comments') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as AstNode).type === 'string') result.push(item as AstNode)
      }
    } else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string') {
      result.push(value as AstNode)
    }
  }
  return result
}

function walk(root: AstNode): AstNode[] {
  const out: AstNode[] = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    out.push(node)
    stack.push(...children(node))
  }
  return out
}

function text(source: string, node: AstNode): string {
  expect(node.range).toBeDefined()
  const [start, end] = node.range!
  return source.slice(start, end)
}

function variableFunction(root: AstNode, name: string): AstNode {
  const declaration = walk(root).find((node) => {
    if (node.type !== 'VariableDeclarator') return false
    const id = node.id as AstNode | undefined
    const init = node.init as AstNode | undefined
    return id?.type === 'Identifier' && (id as { name?: string }).name === name
      && (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
  })
  expect(declaration, `missing function variable ${name}`).toBeDefined()
  return declaration!.init as AstNode
}

function findIf(root: AstNode, source: string, testFragment: string): AstNode {
  const match = walk(root).find((node) => {
    if (node.type !== 'IfStatement') return false
    return text(source, node.test as AstNode).includes(testFragment)
  })
  expect(match, `missing if(${testFragment})`).toBeDefined()
  return match!
}

function containsReturn(node: AstNode): boolean {
  return walk(node).some((candidate) => candidate.type === 'ReturnStatement')
}

describe('Control Centre WhatsApp executable control-flow AST', () => {
  it('cancellation structurally returns before the Edge Function invocation', () => {
    const source = read('../src/components/crm/LeadDetailSheet.tsx')
    const handler = variableFunction(ast(source, true), 'handleWhatsappSend')
    const cancelIf = findIf(handler, source, '!confirmed')
    expect(containsReturn(cancelIf.consequent as AstNode)).toBe(true)

    const invokeCall = walk(handler).find((node) => node.type === 'CallExpression' && text(source, node).includes("supabase.functions.invoke('whatsapp-send'"))
    expect(invokeCall).toBeDefined()
    expect(cancelIf.range![0]).toBeLessThan(invokeCall!.range![0])
  })

  it('ambiguous UI outcomes preserve the same intent while explicit provider failure may clear it', () => {
    const source = read('../src/components/crm/LeadDetailSheet.tsx')
    const handler = variableFunction(ast(source, true), 'handleWhatsappSend')

    const explicitFailure = findIf(handler, source, "providerStatus === 'failed'")
    expect(text(source, explicitFailure.consequent as AstNode)).toContain('setWhatsappIntentKey(null)')

    const ambiguous = findIf(handler, source, "data?.pending === true || data?.providerStatus === 'unknown'")
    expect(text(source, ambiguous.consequent as AstNode)).not.toContain('setWhatsappIntentKey(null)')
    expect(text(source, ambiguous.consequent as AstNode)).toContain('pending: true')

    const catchClause = walk(handler).find((node) => node.type === 'CatchClause')
    expect(catchClause).toBeDefined()
    expect(text(source, catchClause!)).not.toContain('setWhatsappIntentKey(null)')
  })

  it('server-side rate-limit and duplicate branches return before a request can leave the enqueue boundary', () => {
    const source = read('../../supabase/functions/whatsapp-send/index.ts')
    const root = ast(source)
    const serveCall = walk(root).find((node) => node.type === 'CallExpression' && text(source, node).startsWith('Deno.serve('))
    expect(serveCall, 'missing Deno.serve in whatsapp-send').toBeDefined()
    const callback = ((serveCall!.arguments as AstNode[]) || [])[0]
    expect(callback, 'missing Deno.serve callback in whatsapp-send').toBeDefined()
    expect(callback.type).toBe('ArrowFunctionExpression')

    const rateLimited = findIf(callback, source, 'decision === "rate_limited"')
    const duplicate = findIf(callback, source, 'decision === "duplicate"')
    expect(containsReturn(rateLimited.consequent as AstNode)).toBe(true)
    expect(containsReturn(duplicate.consequent as AstNode)).toBe(true)

    expect(source).not.toContain('graph.facebook.com')
    expect(source).not.toContain('WHATSAPP_ACCESS_TOKEN')
    expect(source).not.toContain('WHATSAPP_PHONE_NUMBER_ID')
    expect(text(source, callback)).toContain('providerStatus: "queued"')
  })

  it('authorized enqueue authenticates and encrypts before reservation while Meta runs only after worker claim', () => {
    const enqueueSource = read('../../supabase/functions/whatsapp-send/index.ts')
    const enqueueRoot = ast(enqueueSource)
    const enqueueServe = walk(enqueueRoot).find((node) => node.type === 'CallExpression' && text(enqueueSource, node).startsWith('Deno.serve('))
    expect(enqueueServe, 'missing Deno.serve in whatsapp-send').toBeDefined()
    const enqueueCallback = ((enqueueServe!.arguments as AstNode[]) || [])[0]
    expect(enqueueCallback, 'missing Deno.serve callback in whatsapp-send').toBeDefined()
    expect(enqueueCallback.type).toBe('ArrowFunctionExpression')

    const authCall = walk(enqueueCallback).find((node) => node.type === 'AwaitExpression' && text(enqueueSource, node).includes('authenticatedContext(req)'))
    const encryptCall = walk(enqueueCallback).find((node) => node.type === 'AwaitExpression' && text(enqueueSource, node).includes('encryptMessage(message, leadId, messageSha256)'))
    const reservation = walk(enqueueCallback).find((node) => node.type === 'AwaitExpression' && text(enqueueSource, node).includes('prepareSendAsync('))

    expect(authCall).toBeDefined()
    expect(encryptCall).toBeDefined()
    expect(reservation).toBeDefined()
    expect(authCall!.range![0]).toBeLessThan(encryptCall!.range![0])
    expect(encryptCall!.range![0]).toBeLessThan(reservation!.range![0])

    const workerSource = read('../../supabase/functions/whatsapp-outbound-worker/index.ts')
    const workerRoot = ast(workerSource)
    const workerServe = walk(workerRoot).find((node) => node.type === 'CallExpression' && text(workerSource, node).startsWith('Deno.serve('))
    expect(workerServe, 'missing Deno.serve in whatsapp-outbound-worker').toBeDefined()
    const workerCallback = ((workerServe!.arguments as AstNode[]) || [])[0]
    expect(workerCallback, 'missing Deno.serve callback in whatsapp-outbound-worker').toBeDefined()
    expect(workerCallback.type).toBe('ArrowFunctionExpression')

    const claim = walk(workerCallback).find((node) => node.type === 'AwaitExpression' && text(workerSource, node).includes('nvx_claim_whatsapp_outbound_payload'))
    const markSending = walk(workerCallback).find((node) => node.type === 'AwaitExpression' && text(workerSource, node).includes('markSending(admin, row)'))
    const providerCall = walk(workerCallback).find((node) => node.type === 'AwaitExpression' && text(workerSource, node).includes('sendWhatsAppText'))
    const missingMessageId = findIf(workerCallback, workerSource, '!messageId')
    const acceptedFinalize = walk(workerCallback).find((node) => node.type === 'AwaitExpression' && text(workerSource, node).includes('finalizeSend(admin, row, "accepted"'))

    expect(claim).toBeDefined()
    expect(markSending).toBeDefined()
    expect(providerCall).toBeDefined()
    expect(acceptedFinalize).toBeDefined()
    expect(claim!.range![0]).toBeLessThan(markSending!.range![0])
    expect(markSending!.range![0]).toBeLessThan(providerCall!.range![0])
    expect(missingMessageId.range![0]).toBeLessThan(acceptedFinalize!.range![0])
  })
})
