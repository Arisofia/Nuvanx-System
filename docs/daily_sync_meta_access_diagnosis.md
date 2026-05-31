# Diagnóstico del fallo `Daily Sync Orchestrator` en `verify-meta-access`

El fallo observado en GitHub Actions ocurre durante el paso crítico `verify-meta-access`, antes de ejecutar la sincronización de Doctoralia y el despliegue de agregados diarios. La causa principal encontrada es doble: el workflow no estaba inyectando variables `META_*` al orquestador y, además, el repositorio no muestra secretos `META_*` configurados mediante `gh secret list`. Con esa combinación, el script no recibe `META_ACCESS_TOKEN` ni cuenta publicitaria objetivo y aborta.

La corrección aplicada hace que `.github/workflows/daily-sync.yml` pase explícitamente `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_AD_ACCOUNT_IDS`, `META_APP_SECRET` y `META_GRAPH_VERSION` al script. También actualiza `scripts/verify-meta-access.js` para soportar `appsecret_proof` mediante `META_APP_SECRET`, validar una o varias cuentas publicitarias y mostrar errores seguros sin imprimir tokens.

| Secreto de GitHub Actions | Obligatorio | Uso |
|---|---:|---|
| `META_ACCESS_TOKEN` | Sí | Token de Meta Marketing API usado por la verificación. |
| `META_AD_ACCOUNT_ID` | Sí, si no se usa `META_AD_ACCOUNT_IDS` | Cuenta publicitaria principal en formato `act_...` o solo numérico. |
| `META_AD_ACCOUNT_IDS` | Recomendado para visión completa | Lista separada por comas con ambas cuentas publicitarias que deben ser visibles por el token. |
| `META_APP_SECRET` | Recomendado / necesario si la app exige prueba segura | Permite calcular `appsecret_proof` para llamadas server-side. |
| `META_GRAPH_VERSION` | Opcional | Versión Graph API; por defecto se usa `v20.0`. |

Para que el workflow deje de fallar, configura los secretos desde GitHub en **Settings → Secrets and variables → Actions → Repository secrets**, o desde CLI con `gh secret set`. No pegues secretos en archivos versionados ni en logs.

Una configuración recomendada para visión completa sería definir `META_AD_ACCOUNT_IDS` con ambas cuentas publicitarias separadas por coma. El token debe tener acceso efectivo a ambas cuentas en Meta Business Manager y permisos de Marketing API suficientes, al menos lectura de anuncios para esta verificación.

## Verificación local realizada

Se ejecutó `node --check scripts/verify-meta-access.js` y la sintaxis es válida. También se probó el comportamiento sin variables Meta, confirmando que ahora devuelve un error accionable: `Missing required GitHub secret/env var: META_ACCESS_TOKEN.`. Finalmente, `git diff --check` no reportó errores de whitespace en los archivos modificados.
