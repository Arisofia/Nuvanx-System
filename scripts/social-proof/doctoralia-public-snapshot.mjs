#!/usr/bin/env node
/**
 * NUVANX · Doctoralia public snapshot
 *
 * Purpose:
 * - Use only the public Doctoralia page, without Doctoralia PRO.
 * - Extract conversion-safe public proof signals.
 * - Never invent review counts.
 *
 * Usage:
 *   node scripts/social-proof/doctoralia-public-snapshot.mjs \
 *     --url "https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser" \
 *     --out tmp/doctoralia-public-snapshot.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_URL = 'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser';

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, regex) {
  const m = String(text || '').match(regex);
  return m ? m[1].trim() : '';
}

function has(text, needle) {
  return String(text || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function parseSnapshot(html, finalUrl) {
  const text = stripHtml(html);

  const opinionCountRaw = firstMatch(text, /(?:Opiniones sobre los especialistas \()?([0-9]+)\)?|\b([0-9]+)\s+opiniones?\b/i);
  const opinionCount = Number(opinionCountRaw || 0) || 0;

  const title = firstMatch(text, /#?\s*(NUVANX[^#]+?ENDOLIFT)/i) || 'NUVANX Medicina Estética Láser/ ENDOLIFT';
  const sanitaryRegistry = firstMatch(text, /Número de Registro Sanitario\s+([A-Z0-9]+)/i);
  const responsible = firstMatch(text, /Responsable sanitario\s+(Dr\.\s*José Javier Rivera Tejeda|Dr\.\s*Jose Javier Rivera Tejeda)/i);

  const firstPublicReview = {
    visible_name: has(text, 'Lourdes') ? 'Lourdes' : '',
    verification: has(text, 'Cita verificada') ? 'Cita verificada' : '',
    date: firstMatch(text, /(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i),
    treatment: firstMatch(text, /Dr\.\s*Jose Javier Rivera Tejeda\s+•\s+([^*]+?)(?:\s+\*|\s+Se ha producido|$)/i),
    excerpt_safe: has(text, 'a partir de ahora será mi médico estético') ? 'La paciente indica que volvería a confiar en el médico estético tras la visita.' : '',
  };

  return {
    source: 'Doctoralia public page',
    checked_at: new Date().toISOString(),
    input_url: DEFAULT_URL,
    final_url: finalUrl,
    title,
    public_opinion_count_detected: opinionCount,
    do_not_claim_93_reviews_unless_separately_verified: true,
    public_signals: {
      sanitary_registry: sanitaryRegistry || 'CS20144',
      responsible_sanitary: responsible || 'Dr. José Javier Rivera Tejeda',
      equipment: {
        laser_medico: has(text, 'Láser Médico'),
        lasemar1500_endolift: has(text, 'LaseMaR1500/Endolift'),
        laser_co2_fraccionado: has(text, 'Láser Fraccionado CO2'),
      },
      address: has(text, 'Calle Fernández de la Hoz 4') ? 'Calle Fernández de la Hoz 4, Bajo Derecha, Madrid 28010' : '',
    },
    first_public_review: firstPublicReview,
    web_block_copy: {
      headline: 'Opiniones verificadas en Doctoralia',
      body: 'NUVANX cuenta con ficha pública en Doctoralia, donde las opiniones se muestran como verificadas por la plataforma. Consulta la experiencia publicada por pacientes antes de solicitar tu valoración médica.',
      cta: 'Ver ficha en Doctoralia',
    },
    meta_ads_copy: [
      {
        name: 'Social proof general',
        text: 'Pacientes de NUVANX destacan la claridad en la valoración médica, el trato discreto y el seguimiento posterior. Medicina estética láser con dirección médica en Madrid. Valoración médica gratuita en Chamberí o Goya.',
      },
      {
        name: 'Endolift compliance-safe',
        text: 'Antes de indicar Endolift®, valoramos anatomía, piel, expectativas y recuperación. NUVANX Medicina Estética Láser · Dirección médica · Madrid. Valoración médica gratuita.',
      },
      {
        name: 'Laser technology',
        text: 'Tecnología LaseMaR1500, Smartlipo DEKA y láser CO2 fraccionado con indicación médica individual. NUVANX · Chamberí y Goya / Barrio Salamanca.',
      },
    ],
    google_review_request_copy: 'Gracias por visitarnos en NUVANX. Si tu experiencia fue positiva, nos ayudaría mucho que pudieras dejar una reseña en Google sobre tu valoración y atención en clínica. No hace falta que menciones datos médicos personales; solo tu experiencia real con el equipo, la claridad de la explicación y el trato recibido. [ENLACE_RESEÑA_GOOGLE]',
  };
}

async function main() {
  const url = getArg('--url', DEFAULT_URL);
  const out = getArg('--out', 'tmp/doctoralia-public-snapshot.json');

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 NUVANX-SocialProofAudit/1.0',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const html = await response.text();
  const snapshot = parseSnapshot(html, response.url || url);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error('Doctoralia public snapshot failed:', error);
  process.exit(1);
});
