#!/usr/bin/env node

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ssvvuuysgxyqvmovrlvk.supabase.co'
const accessToken = process.env.SUPABASE_ACCESS_JWT || process.env.ACCESS_TOKEN || process.env.NUVANX_ACCESS_TOKEN
const provider = process.env.AI_PROVIDER || 'gemini'
const prompt = process.env.AI_PROMPT || 'Analiza los leads de la última semana y sugiere acciones'

if (!accessToken) {
  console.error('Missing SUPABASE_ACCESS_JWT (or ACCESS_TOKEN / NUVANX_ACCESS_TOKEN).')
  process.exit(2)
}

const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/api/ai/generate`

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ prompt, provider }),
})

const text = await res.text()
let data
try {
  data = JSON.parse(text)
} catch {
  data = { raw: text }
}

console.log(JSON.stringify(data, null, 2))

if (!res.ok || !data?.success || !data?.outputId) {
  console.error(`AI generate persistence check failed: HTTP ${res.status}; outputId=${data?.outputId ?? null}`)
  process.exit(1)
}

console.log(`AI generate persisted agent_outputs row: ${data.outputId}`)
