// ============================================================
// LEAD SCORER — Cloudflare Worker (Secure Version)
// Stack: Workers AI (Llama-4-Scout, gratis) + HubSpot CRM
// Security: Authenticated, HTML-escaped, CORS-restricted
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Simple authentication check
function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  const expectedToken = env.AUTH_TOKEN;
  
  if (!expectedToken) {
    return true; // Allow if no token configured (development mode)
  }
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.replace('Bearer ', '').trim();
  return token === expectedToken;
}

// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Lógica de scoring basada en datos reales del CRM ────────
function scoreLeadLocally(contact) {
  let score = 0;
  const reasons = [];

  const status = contact.hs_lead_status || '';
  const stage  = contact.lifecyclestage  || '';
  const deals  = parseInt(contact.num_associated_deals || '0', 10);
  const worked = contact.hs_is_unworked;

  if (status === 'CONNECTED')              { score += 40; reasons.push('+40 Conectado (respondió)'); }
  if (status === 'IN_PROGRESS')            { score += 30; reasons.push('+30 En progreso'); }
  if (status === 'ATTEMPTED_TO_CONTACT')   { score += 10; reasons.push('+10 Intento de contacto'); }
  if (deals >= 1)                          { score += 50; reasons.push('+50 Tiene deal abierto'); }
  if (stage === 'marketingqualifiedlead')  { score += 20; reasons.push('+20 MQL'); }
  if (stage === 'opportunity')             { score += 35; reasons.push('+35 Oportunidad'); }
  if (status === 'UNQUALIFIED')            { score -= 50; reasons.push('-50 Sin calificar'); }
  if (worked === 'true')                   { score -= 10; reasons.push('-10 Sin trabajar'); }

  const tier = score >= 60 ? 'HOT' : score >= 30 ? 'WARM' : 'COLD';
  const sendToMeta = score >= 60;

  return { score, tier, sendToMeta, reasons };
}

// ── Enriquecimiento con AI (Workers AI, modelo gratuito) ─────
async function enrichWithAI(env, contact, localScore) {
  const prompt = `Eres un sistema de calificación de leads de marketing. 
Analiza este lead y devuelve SOLO un JSON válido sin markdown.

Lead:
- Nombre: ${contact.firstname || ''} ${contact.lastname || ''}
- Email: ${contact.email || ''}
- Etapa CRM: ${contact.lifecyclestage || 'desconocida'}
- Estado lead: ${contact.hs_lead_status || 'sin estado'}
- Deals asociados: ${contact.num_associated_deals || '0'}
- Sin trabajar: ${contact.hs_is_unworked || 'false'}
- Score base calculado: ${localScore.score}/100

Responde ÚNICAMENTE con este JSON (sin texto extra, sin backticks):
{
  "ai_score_adjustment": <número entre -20 y +20>,
  "quality_label": "<Alta|Media|Baja>",
  "recommended_action": "<acción concreta en menos de 10 palabras>",
  "meta_capi_priority": "<Inmediato|Esta semana|Baja prioridad>"
}`;

  try {
    const response = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    });

    const raw = response?.response || response?.result?.response || '';
    // Extraer JSON robusto
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    console.error('AI error:', e.message);
  }

  // Fallback si falla la IA
  return {
    ai_score_adjustment: 0,
    quality_label: localScore.tier === 'HOT' ? 'Alta' : localScore.tier === 'WARM' ? 'Media' : 'Baja',
    recommended_action: localScore.sendToMeta ? 'Enviar a Meta CAPI ahora' : 'Seguir nurturing',
    meta_capi_priority: localScore.sendToMeta ? 'Inmediato' : 'Baja prioridad',
  };
}

// ── HubSpot: obtener contactos recientes ─────────────────────
async function fetchHubSpotLeads(env) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts?limit=100' +
    '&properties=firstname,lastname,email,phone,lifecyclestage,hs_lead_status,' +
    'num_associated_deals,hs_is_unworked,hs_buying_role';

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`HubSpot error: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

// ── HubSpot: actualizar propiedad lead_score_meta ────────────
async function updateHubSpotScore(env, contactId, score, tier, action) {
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        lead_score_meta: String(score),
        hs_lead_status: tier === 'HOT' && action ? 'IN_PROGRESS' : undefined,
      },
    }),
  });
  
  if (!res.ok) {
    console.error('HubSpot update failed:', res.status, await res.text());
    return false;
  }
  return true;
}

// ── Dashboard HTML ───────────────────────────────────────────
function renderDashboard(leads, stats) {
  const rows = leads.map(l => {
    const tierColor = l.tier === 'HOT' ? '#ef4444' : l.tier === 'WARM' ? '#f97316' : '#6b7280';
    const metaBadge = l.sendToMeta
      ? `<span style="background:#1877f2;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">→ META CAPI</span>`
      : '';
    return `<tr>
      <td>${escapeHtml(l.name)}</td>
      <td>${escapeHtml(l.email)}</td>
      <td><span style="color:${tierColor};font-weight:700">${escapeHtml(l.tier)}</span></td>
      <td style="font-weight:700">${l.finalScore}</td>
      <td>${escapeHtml(l.quality_label)}</td>
      <td>${escapeHtml(l.recommended_action)}</td>
      <td>${escapeHtml(l.meta_capi_priority)} ${metaBadge}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lead Scorer · Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d0f14;
    --surface: #161a23;
    --border: #1f2535;
    --text: #e2e8f0;
    --muted: #64748b;
    --hot: #ef4444;
    --warm: #f97316;
    --cold: #64748b;
    --meta: #1877f2;
    --accent: #6366f1;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }

  header {
    padding: 24px 32px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .logo {
    width: 36px; height: 36px;
    background: var(--accent);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }

  header h1 { font-size: 18px; font-weight: 600; letter-spacing: -.3px; }
  header p  { font-size: 12px; color: var(--muted); }

  .badge {
    margin-left: auto;
    display: flex; gap: 8px; align-items: center;
  }

  .pill {
    font-size: 11px; font-weight: 600;
    padding: 3px 10px; border-radius: 20px;
    background: rgba(99,102,241,.15);
    color: var(--accent);
    border: 1px solid rgba(99,102,241,.3);
  }

  main { padding: 28px 32px; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }

  .stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }

  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; letter-spacing: -1px; }
  .stat-value.hot  { color: var(--hot); }
  .stat-value.warm { color: var(--warm); }
  .stat-value.meta { color: var(--meta); }
  .stat-value.ai   { color: var(--accent); }

  .table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .table-head {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }

  .table-head h2 { font-size: 14px; font-weight: 600; }

  table { width: 100%; border-collapse: collapse; }

  th {
    text-align: left;
    padding: 10px 16px;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .06em;
    border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,.02);
  }

  td {
    padding: 11px 16px;
    border-bottom: 1px solid rgba(31,37,53,.7);
    font-size: 13px;
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.02); }

  .refresh-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }

  .refresh-btn:hover { opacity: .85; }

  footer {
    padding: 16px 32px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    display: flex; gap: 16px; justify-content: space-between;
  }

  .model-badge {
    display: inline-flex; align-items: center; gap: 5px;
    background: rgba(24,119,242,.12);
    color: #60a5fa;
    border: 1px solid rgba(24,119,242,.25);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px; font-weight: 600;
  }

  @media (max-width: 768px) {
    main, header, footer { padding: 16px; }
    .stats { grid-template-columns: repeat(2,1fr); }
    table { font-size: 12px; }
    th, td { padding: 8px 10px; }
  }
</style>
</head>
<body>

<header>
  <div class="logo">⚡</div>
  <div>
    <h1>Lead Scorer</h1>
    <p>HubSpot CRM · Cloudflare Workers AI · Meta CAPI</p>
  </div>
  <div class="badge">
    <span class="model-badge">🤗 Llama-4-Scout · Gratis</span>
    <a href="/score" class="refresh-btn">↻ Actualizar</a>
  </div>
</header>

<main>
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total analizados</div>
      <div class="stat-value ai">${stats.total}</div>
    </div>
    <div class="stat">
      <div class="stat-label">HOT (≥60 pts)</div>
      <div class="stat-value hot">${stats.hot}</div>
    </div>
    <div class="stat">
      <div class="stat-label">WARM (30-59)</div>
      <div class="stat-value warm">${stats.warm}</div>
    </div>
    <div class="stat">
      <div class="stat-label">→ Meta CAPI</div>
      <div class="stat-value meta">${stats.metaReady}</div>
    </div>
  </div>

  <div class="table-wrap">
    <div class="table-head">
      <h2>Leads analizados por IA</h2>
      <span style="color:var(--muted);font-size:12px">Actualizado: ${new Date().toLocaleString('es-ES')}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Email</th>
          <th>Tier</th>
          <th>Score</th>
          <th>Calidad IA</th>
          <th>Acción recomendada</th>
          <th>Prioridad Meta</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</main>

<footer>
  <span>Coste IA: €0 · Cloudflare Workers AI free tier (10k neurons/día)</span>
  <span>Modelo: @cf/meta/llama-4-scout-17b-16e-instruct</span>
</footer>

</body>
</html>`;
}

// ── Router principal ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // GET / → Dashboard (requires auth in production)
    if (url.pathname === '/' || url.pathname === '') {
      if (!authenticate(request, env)) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }
      return new Response(renderDashboard([], {
        total: 0, hot: 0, warm: 0, metaReady: 0
      }), {
        headers: { ...CORS, 'Content-Type': 'text/html;charset=utf-8' }
      });
    }

    // GET /score → Analiza leads y muestra dashboard (requires auth)
    if (url.pathname === '/score') {
      if (!authenticate(request, env)) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }

      try {
        if (!env.HUBSPOT_TOKEN) {
          return new Response('Error: HUBSPOT_TOKEN no configurado en Variables de entorno de Cloudflare.', { status: 500, headers: CORS });
        }

        const contacts = await fetchHubSpotLeads(env);

        // Procesar hasta 20 leads (límite neurons gratis)
        const sample = contacts.slice(0, 20);
        const results = [];
        const hubspotUpdateErrors = [];

        for (const c of sample) {
          const props = c.properties || {};
          const local  = scoreLeadLocally(props);
          const ai     = await enrichWithAI(env, props, local);

          const finalScore = Math.max(0, Math.min(100,
            local.score + (ai.ai_score_adjustment || 0)
          ));

          // Recalculate tier and sendToMeta from finalScore (fix AI threshold issue)
          const finalTier = finalScore >= 60 ? 'HOT' : finalScore >= 30 ? 'WARM' : 'COLD';
          const finalSendToMeta = finalScore >= 60;

          results.push({
            id:                  c.id,
            name:                `${props.firstname || ''} ${props.lastname || ''}`.trim() || '(sin nombre)',
            email:               props.email || '',
            tier:                finalTier,
            finalScore,
            sendToMeta:          finalSendToMeta,
            reasons:             local.reasons,
            quality_label:       ai.quality_label,
            recommended_action:  ai.recommended_action,
            meta_capi_priority:  ai.meta_capi_priority,
          });

          // Guardar score en HubSpot (with error tracking)
          const updateSuccess = await updateHubSpotScore(
            env, c.id, finalScore, finalTier, ai.recommended_action
          );
          if (!updateSuccess) {
            hubspotUpdateErrors.push(c.id);
          }
        }

        // Ordenar por score desc
        results.sort((a, b) => b.finalScore - a.finalScore);

        const stats = {
          total:     results.length,
          hot:       results.filter(r => r.tier === 'HOT').length,
          warm:      results.filter(r => r.tier === 'WARM').length,
          metaReady: results.filter(r => r.sendToMeta).length,
        };

        const responseHtml = renderDashboard(results, stats);
        
        // Add error info if any
        if (hubspotUpdateErrors.length > 0) {
          console.error('HubSpot update errors for contacts:', hubspotUpdateErrors);
        }

        return new Response(responseHtml, {
          headers: { ...CORS, 'Content-Type': 'text/html;charset=utf-8' }
        });

      } catch (err) {
        return new Response(`Error: ${err.message}`, { status: 500, headers: CORS });
      }
    }

    // GET /api/leads → JSON para integración externa (requires auth)
    if (url.pathname === '/api/leads') {
      if (!authenticate(request, env)) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }

      try {
        const contacts = await fetchHubSpotLeads(env);
        
        // Run AI enrichment for the JSON endpoint as well (fix dashboard AI display)
        const results = [];
        for (const c of contacts.slice(0, 20)) {
          const props = c.properties || {};
          const local = scoreLeadLocally(props);
          const ai = await enrichWithAI(env, props, local);
          
          const finalScore = Math.max(0, Math.min(100,
            local.score + (ai.ai_score_adjustment || 0)
          ));
          
          const finalTier = finalScore >= 60 ? 'HOT' : finalScore >= 30 ? 'WARM' : 'COLD';
          const finalSendToMeta = finalScore >= 60;

          results.push({
            id: c.id,
            ...props,
            ...local,
            finalScore,
            tier: finalTier,
            sendToMeta: finalSendToMeta,
            quality_label: ai.quality_label,
            recommended_action: ai.recommended_action,
            meta_capi_priority: ai.meta_capi_priority,
          });
        }
        
        return new Response(JSON.stringify(results, null, 2), {
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  }
};