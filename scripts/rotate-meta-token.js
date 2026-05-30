#!/usr/bin/env node
/**
 * rotate-meta-token.js
 *
 * Herramienta especializada para rotar de forma segura el token de Meta
 * con foco en resolver problemas de permisos en cuentas específicas
 * (especialmente act_9523446201036125 - Francisco Antonio).
 *
 * Uso recomendado (flujo más seguro):
 *   1. Genera un token (puede ser de corta duración) siguiendo docs/meta_ads_access_unlock.md
 *   2. Ejecuta con el token en variable de entorno:
 *
 *      META_ACCESS_TOKEN_NEW="EAA..." node scripts/rotate-meta-token.js --all
 *
 *   El script puede automáticamente convertir el token a larga duración (60 días)
 *   si tienes META_APP_ID y META_APP_SECRET configurados.
 *
 * Opciones:
 *   --validate         : Solo valida permisos del token actual
 *   --exchange         : Convierte el token a larga duración usando App Secret
 *   --update-local     : Actualiza .env.tokens.local
 *   --sync             : Sincroniza a Supabase / Vercel / GitHub
 *   --all              : Hace validate + exchange (si es posible) + update + sync
 *
 * El script NUNCA imprime el valor del token.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function getAppSecretProof(token) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return '';
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex');
}

const TARGET_ACCOUNT = 'act_9523446201036125';
const SECONDARY_ACCOUNT = 'act_4172099716404860';

const args = process.argv.slice(2);
const flags = {
  validate: args.includes('--validate') || args.includes('--all'),
  updateLocal: args.includes('--update-local') || args.includes('--all'),
  sync: args.includes('--sync') || args.includes('--all'),
  guide: args.includes('--guide') || args.includes('--help') || args.length === 0,
};

const newToken = process.env.META_ACCESS_TOKEN_NEW?.trim();

if (!newToken) {
  console.error('ERROR: Debes proporcionar el nuevo token vía variable de entorno:');
  console.error('  META_ACCESS_TOKEN_NEW="EAA..." node scripts/rotate-meta-token.js --all');
  console.error('');
  console.error('Primero genera el token siguiendo: docs/meta_ads_access_unlock.md');
  process.exit(1);
}

function sanitizeForLog(str) {
  return str.replace(/EAA[A-Za-z0-9_-]+/g, '[REDACTED_META_TOKEN]');
}

async function exchangeToLongLived(shortLivedToken) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('❌ Para convertir el token a larga duración necesitas tener META_APP_ID y META_APP_SECRET en tu entorno local.');
    console.error('   Agrégalos a .env.tokens.local y vuelve a intentarlo.');
    return null;
  }

  console.log('🔄 Convirtiendo token a versión de larga duración (60 días)...');

  try {
    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('❌ Error al intercambiar el token:', data.error.message);
      return null;
    }

    if (data.access_token) {
      console.log('✅ Token convertido exitosamente a larga duración.');
      return data.access_token;
    }

    return null;
  } catch (err) {
    console.error('❌ Falló el intercambio del token:', err.message);
    return null;
  }
}

async function checkBasicTokenValidity(token, proofParam) {
  try {
    const meUrl = `https://graph.facebook.com/v21.0/me?access_token=${token}${proofParam}&fields=id,name`;
    const meRes = await fetch(meUrl);
    const meData = await meRes.json();

    if (meData.error) {
      throw new Error(`Token inválido: ${meData.error.message}`);
    }
    console.log(`✅ Token válido. Usuario: ${meData.name || meData.id}`);
    return true;
  } catch (err) {
    console.error('❌ El token no es válido o falló la llamada a /me');
    console.error(sanitizeForLog(String(err)));
    return false;
  }
}

async function fetchAccessibleAccounts(token, proofParam) {
  const accountsUrl = `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${token}${proofParam}&fields=id,name,account_status&limit=100`;
  const accRes = await fetch(accountsUrl);
  const accData = await accRes.json();

  if (accData.error) {
    throw new Error(accData.error.message);
  }

  return (accData.data || []).map(a => ({
    id: a.id.startsWith('act_') ? a.id : `act_${a.id}`,
    name: a.name || '',
    status: a.account_status,
  }));
}

async function checkSingleAccount(token, proofParam, accountId, accessibleAccounts) {
  const found = accessibleAccounts.find(a => a.id === accountId);

  if (!found) {
    return {
      id: accountId,
      status: 'not_visible',
      message: 'La cuenta no aparece en /me/adaccounts del token.',
    };
  }

  try {
    const readUrl = `https://graph.facebook.com/v21.0/${accountId}?access_token=${token}${proofParam}&fields=id,name,account_status,currency`;
    const readRes = await fetch(readUrl);
    const readData = await readRes.json();

    if (readData.error) {
      const msg = readData.error.message || '';
      const isPerm = msg.toLowerCase().includes('permission') || msg.includes('#10');
      return {
        id: accountId,
        status: isPerm ? 'permission_error' : 'read_error',
        message: msg,
      };
    }

    const insightsUrl = `https://graph.facebook.com/v21.0/${accountId}/insights?access_token=${token}${proofParam}&fields=spend&date_preset=last_7d&level=account&limit=1`;
    const insRes = await fetch(insightsUrl);
    const insData = await insRes.json();

    if (insData.error) {
      const msg = insData.error.message || '';
      const isPerm = msg.toLowerCase().includes('permission') || msg.includes('#10');
      return {
        id: accountId,
        status: isPerm ? 'permission_error' : 'insights_error',
        message: msg,
        name: readData.name,
      };
    }

    return {
      id: accountId,
      status: 'ok',
      name: readData.name,
      currency: readData.currency,
    };
  } catch (err) {
    return {
      id: accountId,
      status: 'error',
      message: sanitizeForLog(String(err)),
    };
  }
}

async function validateMetaAccess(token) {
  console.log('🔍 Validando permisos del nuevo token contra las cuentas configuradas...\n');

  const results = [];
  const proof = getAppSecretProof(token);
  const proofParam = proof ? `&appsecret_proof=${proof}` : '';

  // 1. Basic token validity
  const isValid = await checkBasicTokenValidity(token, proofParam);
  if (!isValid) {
    return { success: false, error: 'invalid_token' };
  }

  // 2. Fetch accessible accounts
  let accessibleAccounts;
  try {
    accessibleAccounts = await fetchAccessibleAccounts(token, proofParam);
  } catch (err) {
    console.error('❌ No se pudo listar las cuentas publicitarias accesibles.');
    return { success: false, error: 'cannot_list_adaccounts' };
  }

  // 3. Check each target account
  const accountsToCheck = [TARGET_ACCOUNT, SECONDARY_ACCOUNT];

  for (const accountId of accountsToCheck) {
    const result = await checkSingleAccount(token, proofParam, accountId, accessibleAccounts);
    results.push(result);
  }

  // Mostrar resultados
  console.log('\n=== Resultado de validación por cuenta ===\n');
  let allGood = true;

  for (const r of results) {
    if (r.status === 'ok') {
      console.log(`✅ ${r.id}  (${r.name || ''})  [${r.currency || ''}]`);
    } else if (r.status === 'permission_error') {
      allGood = false;
      console.log(`❌ ${r.id}  — PERMISO DENEGADO (ads_read / ads_management faltante)`);
      console.log(`   Detalle: ${r.message}`);
    } else {
      allGood = false;
      console.log(`❌ ${r.id}  — ${r.status.toUpperCase()}`);
      console.log(`   ${r.message}`);
    }
  }

  const targetResult = results.find(r => r.id === TARGET_ACCOUNT);
  if (targetResult?.status !== 'ok') {
    console.log('\n⚠️  La cuenta principal (Francisco Antonio) no tiene acceso completo.');
    console.log('   Revisa: docs/meta_ads_access_unlock.md (sección Business Manager + permisos).');
  }

  return { success: allGood, results };
}

function updateRecommendedLocalFile(token) {
  const preferred = path.join(process.cwd(), '.env.tokens.local');
  const fallback = path.join(process.cwd(), '.env');

  const targetFile = fs.existsSync(preferred) ? preferred : fallback;

  if (!fs.existsSync(targetFile)) {
    console.error(`No se encontró ${targetFile}. Crea primero .env.tokens.local desde .env.example`);
    return false;
  }

  let content = fs.readFileSync(targetFile, 'utf8');
  const regex = /^\s*META_ACCESS_TOKEN\s*=.*$/m;

  if (regex.test(content)) {
    content = content.replace(regex, `META_ACCESS_TOKEN=${token}`);
  } else {
    content += `\nMETA_ACCESS_TOKEN=${token}\n`;
  }

  fs.writeFileSync(targetFile, content, 'utf8');
  console.log(`\n✅ Token actualizado en: ${path.basename(targetFile)}`);
  return true;
}

async function printGuidedSteps() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║   ROTACIÓN DE TOKEN META - ENFOCADO EN act_9523446201036125 (Francisco)     ║
╚══════════════════════════════════════════════════════════════════════════════╝

PASOS EXACTOS QUE DEBES HACER AHORA EN TU NAVEGADOR:

1. Abre esta URL y asegúrate de estar logueado con la cuenta correcta:
   https://business.facebook.com/settings/

2. Ve a "Cuentas publicitarias" → busca y selecciona:
   act_9523446201036125  (Francisco Antonio)

3. En la sección de "Acceso de usuarios", confirma que tu usuario (o el System User)
   tenga rol de **Administrador** sobre esta cuenta.
   → Si no lo tiene, agrégalo ahora.

4. Abre la app de Meta Developers:
   https://developers.facebook.com/apps/

5. Selecciona la app **NUVANX_SYSTEM**

6. Ve a:
   App Review → Permissions and Features

7. Asegúrate de que estén solicitados y activos:
   - ads_read
   - ads_management
   (Si están en "Pending", aprueba o envía a revisión si es necesario)

8. Ve a "Publish" / "Go live" si la app todavía está en Development.

9. Genera un nuevo token largo (recomendado con System User):
   - Opción A (mejor): Business Settings → System Users → Generar nuevo token
     con scopes: ads_read, ads_management, business_management, pages_read_engagement
   - Opción B: https://developers.facebook.com/tools/explorer/
     Selecciona la app NUVANX_SYSTEM y los mismos scopes.

10. Una vez que tengas el token nuevo (empieza con EAA...), cópialo.

11. Vuelve aquí y ejecuta:

    META_ACCESS_TOKEN_NEW="PEGAR_TOKEN_AQUÍ" node scripts/rotate-meta-token.js --all

El script validará automáticamente que el token tenga permisos reales sobre
act_9523446201036125 y sincronizará todo.

──────────────────────────────────────────────────────────────────────────────
`);

  process.exit(0);
}

async function main() {
  if (flags.guide) {
    await printGuidedSteps();
  }

  console.log('🚀 Iniciando rotación de token Meta (enfocado en act_9523446201036125)\n');

  let tokenToUse = newToken;

  // Si el usuario quiere convertir a larga duración
  if (args.includes('--exchange') || args.includes('--all')) {
    const longLived = await exchangeToLongLived(newToken);
    if (longLived) {
      tokenToUse = longLived;
      console.log('Usaremos la versión de larga duración a partir de ahora.\n');
    } else {
      console.log('Continuando con el token original (no se pudo convertir a larga duración).\n');
    }
  }

  let validationResult = { success: true };

  if (flags.validate || args.includes('--all')) {
    validationResult = await validateMetaAccess(tokenToUse);
    if (!validationResult.success) {
      console.error('\n❌ La validación falló. Corrige los permisos en Meta antes de continuar.');
      process.exit(1);
    }
    console.log('\n✅ Validación de permisos exitosa.');
  }

  if (flags.updateLocal) {
    const updated = updateRecommendedLocalFile(tokenToUse);
    if (!updated) process.exit(1);
  }

  if (flags.sync) {
    console.log('\n🔄 Ejecutando sincronización de secretos...');
    try {
      execFileSync('node', ['scripts/sync-platform-secrets.js'], { stdio: 'inherit' });
    } catch (e) {
      // Intentionally swallowing error: synchronization is best-effort.
      // Rotation + validation succeeded; user can run sync manually if needed.
      console.error('⚠️  El sincronizador falló. Los secretos locales están actualizados. Ejecútalo manualmente después si es necesario.');
    }
  }

  console.log('\n✅ Proceso de rotación completado.');

  console.log(`
═══════════════════════════════════════════════════════════════════════════════
  PRÓXIMOS PASOS (cópialos y ejecútalos):

  1. Despliega la Edge Function:
     supabase functions deploy api --project-ref ssvvuuysgxyqvmovrlvk

  2. Verifica en la aplicación (recomendado):
     Ve a la página "Integraciones" → botón "Verificar accesos"

     Deberías ver:
     ✅ act_9523446201036125 (Francisco Antonio)

  3. (Opcional) Verifica desde terminal:
     node scripts/verify-meta-access.js

  Si después de esto sigues viendo error de permisos, el problema está en los
  roles dentro de Business Manager para esa cuenta específica.
═══════════════════════════════════════════════════════════════════════════════
`);
}

main().catch(err => {
  console.error('Error inesperado:', sanitizeForLog(String(err)));
  process.exit(1);
});
