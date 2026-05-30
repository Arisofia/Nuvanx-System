# Diagnóstico Histórico: Fallo en Daily Sync Orchestrator (verify-meta-access)

> **Estado:** Obsoleto / Histórico  
> **Script mencionado (`verify-meta-access.js`):** Ya no existe en el repositorio (fue consolidado dentro de `run-daily-sync.js` y el preflight del workflow).

Este documento describe un fallo antiguo del Daily Sync Orchestrator relacionado con la falta de secretos de Meta y la ausencia del script `verify-meta-access.js`.

## Contexto Original (ya resuelto)

El problema consistía en que el workflow no inyectaba las variables `META_*` correctamente y el script antiguo fallaba si no recibía `META_ACCESS_TOKEN` o las cuentas publicitarias.

La corrección en su momento consistió en:
- Pasar explícitamente los secretos de Meta al script.
- Mejorar la validación y el manejo de errores en `verify-meta-access.js`.

## Estado Actual (Junio 2026)

- El script `verify-meta-access.js` **fue eliminado / consolidado**.
- La lógica de verificación de Meta ahora vive dentro de `scripts/run-daily-sync.js` y el preflight del workflow `daily-sync.yml`.
- Los secretos de Meta se gestionan de forma más centralizada en el job `env:` del workflow.
- El diagnóstico actual de problemas de Meta se realiza principalmente a través de:
  - El preflight del workflow `daily-sync.yml`
  - Los logs estructurados del orquestador
  - El workflow `supabase-security.yml` (para temas de acceso general)

## Recomendación

Este documento se mantiene por trazabilidad histórica.  
Para problemas actuales con el Daily Sync y Meta, consultar directamente:

- `.github/workflows/daily-sync.yml` (preflight y manejo de secretos)
- `scripts/run-daily-sync.js`
- Logs de las ejecuciones del workflow en GitHub Actions

**No se recomienda seguir las instrucciones de este documento tal cual**, ya que hacen referencia a archivos y estructura que ya no existen.

| Secreto de GitHub Actions | Obligatorio | Uso |
|---|---:|---|
| `META_ACCESS_TOKEN` | Sí | Token de Meta Marketing API usado por la verificación. |
| `META_AD_ACCOUNT_ID` | Sí, si no se usa `META_AD_ACCOUNT_IDS` | Cuenta publicitaria principal en formato `act_...` o solo numérico. |
| `META_AD_ACCOUNT_IDS` | Recomendado para visión completa | Lista separada por comas con ambas cuentas publicitarias que deben ser visibles por el token. |
| `META_APP_SECRET` | Recomendado / necesario si la app exige prueba segura | Permite calcular `appsecret_proof` para llamadas server-side. |
| `META_GRAPH_VERSION` | Opcional | Versión Graph API; por defecto se usa `v20.0`. |

Para que el workflow deje de fallar, configura los secretos desde GitHub en **Settings → Secrets and variables → Actions → Repository secrets**, o desde CLI con `gh secret set`. No pegues secretos en archivos versionados ni en logs.

Una configuración recomendada para visión completa sería definir `META_AD_ACCOUNT_IDS` con ambas cuentas publicitarias separadas por coma. El token debe tener acceso efectivo a ambas cuentas en Meta Business Manager y permisos de Marketing API suficientes, al menos lectura de anuncios para esta verificación.

## Nota sobre esta verificación

Esta sección corresponde a la verificación realizada en el momento del incidente original (con el script `verify-meta-access.js`).

Dado que ese script ya no existe y la lógica fue consolidada, esta verificación específica ya no es reproducible ni relevante.

Para verificaciones actuales del flujo de Meta en el Daily Sync, consultar:

- El preflight en `.github/workflows/daily-sync.yml`
- La función de verificación dentro de `scripts/run-daily-sync.js` (si existe) o el orquestador actual.
