#!/usr/bin/env node
/**
 * set-meta-token.js
 *
 * Actualiza la variable META_ACCESS_TOKEN en los archivos .env detectados,
 * y opcionalmente propaga el valor a GitHub, Supabase y Vercel si esos CLIs
 * están configurados.
 *
 * Uso local:
 *   META_ACCESS_TOKEN_NEW=REPLACE_ME node scripts/set-meta-token.js
 *
 * Uso remoto:
 *   META_ACCESS_TOKEN_NEW=REPLACE_ME node scripts/set-meta-token.js --github --supabase --vercel
 *
 * Si no se pasa META_ACCESS_TOKEN_NEW, el script busca el token existente en
 * los archivos locales .env y backend/.env.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flags = {
  github: args.includes('--github'),
  supabase: args.includes('--supabase'),
  vercel: args.includes('--vercel'),
  local: args.includes('--local'),
};

if (args.includes('--all')) {
  flags.github = true;
  flags.supabase = true;
  flags.vercel = true;
  flags.local = true;
}

if (!flags.local && !flags.github && !flags.supabase && !flags.vercel) {
  flags.local = true;
}

function readTokenFromEnvFiles() {
  const searchFiles = [
    '.env',
    '.env.local',
    '.env.tokens.local',
    'backend/.env',
    'frontend/.env',
    'frontend/.env.local',
  ];

  for (const relativePath of searchFiles) {
    const envPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^\s*META_ACCESS_TOKEN\s*=\s*(.*)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

const newToken = process.env.META_ACCESS_TOKEN_NEW || readTokenFromEnvFiles();
if (!newToken) {
  console.error('ERROR: Debes exportar META_ACCESS_TOKEN_NEW con el nuevo token o tenerlo presente en un archivo .env local.');
  console.error('Uso: META_ACCESS_TOKEN_NEW=REPLACE_ME node scripts/set-meta-token.js [--local] [--github] [--supabase] [--vercel]');
  process.exit(1);
}

const envFiles = [
  'backend/.env',
  '.env',
  '.env.local',
  'backend/.env.local',
  'frontend/.env',
  'frontend/.env.local',
];

function updateLocalFiles(token) {
  let updated = 0;
  for (const relativePath of envFiles) {
    const envPath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(envPath)) continue;

    let content = fs.readFileSync(envPath, 'utf8');
    const tokenLineRegex = /^\s*META_ACCESS_TOKEN\s*=.*$/m;

    if (tokenLineRegex.test(content)) {
      content = content.replace(tokenLineRegex, `META_ACCESS_TOKEN=${token}`);
      fs.writeFileSync(envPath, content, 'utf8');
      console.log(`Actualizado: ${relativePath}`);
    } else {
      fs.appendFileSync(envPath, `\nMETA_ACCESS_TOKEN=${token}\n`, 'utf8');
      console.log(`Agregado META_ACCESS_TOKEN a: ${relativePath}`);
    }
    updated += 1;
  }
  return updated;
}

function setGithubSecret(token) {
  console.log('Propagando META_ACCESS_TOKEN a GitHub Actions...');
  execFileSync('gh', ['secret', 'set', 'META_ACCESS_TOKEN', '--body', token], { stdio: 'inherit' });
}

function setSupabaseSecret(token) {
  console.log('Propagando META_ACCESS_TOKEN a Supabase...');
  execFileSync('supabase', ['secrets', 'set', `META_ACCESS_TOKEN=${token}`], { stdio: 'inherit' });
}

function setVercelEnv(token) {
  console.log('Propagando META_ACCESS_TOKEN a Vercel (producción)...');
  try {
    execFileSync('vercel', ['env', 'update', 'META_ACCESS_TOKEN', 'production', '--value', token, '--yes'], { stdio: 'inherit' });
    return;
  } catch (error) {
    console.log('La variable no existe en Vercel o no se pudo actualizar, intentando crearla...');
    try {
      execFileSync('vercel', ['env', 'add', 'META_ACCESS_TOKEN', 'production', '--value', token, '--force', '--yes'], { stdio: 'inherit' });
      return;
    } catch (addError) {
      console.warn('No se pudo propagar META_ACCESS_TOKEN a Vercel. Asegúrate de que el proyecto está vinculado con `vercel link`.');
      console.warn(addError.message || addError);
    }
  }
}

let localUpdated = 0;
if (flags.local) {
  localUpdated = updateLocalFiles(newToken);
  if (localUpdated === 0) {
    console.warn('No se encontraron archivos .env a actualizar en este proyecto.');
  }
}

if (flags.github) {
  setGithubSecret(newToken);
}

if (flags.supabase) {
  setSupabaseSecret(newToken);
}

if (flags.vercel) {
  setVercelEnv(newToken);
}

console.log('Listo.');
if (flags.local) {
  console.log(`Archivos locales actualizados: ${localUpdated}`);
}
process.exit(0);
