# Desbloqueo técnico de Meta Ads para visión completa

Este documento resume los pasos necesarios para que **NUVANX_SYSTEM** pueda operar con visión completa sobre las cuentas publicitarias requeridas y para completar la creación de creatividades nuevas A1–A4 desde la Marketing API. La app identificada como `1451306619299617` está actualmente en modo desarrollo; por tanto, su uso queda limitado a personas con rol dentro de la app y puede bloquear operaciones de producción o creatividades nuevas para cuentas no cubiertas por esos roles.

> Meta indica que una app debe publicarse o ponerse en modo live para que pueda ser usada por cuentas que no tienen rol dentro de la app, y que las apps que requieran permisos revisables deben completar revisión antes de usar esos permisos con usuarios externos.[1]

| Bloqueo actual | Acción requerida | Resultado esperado |
|---|---|---|
| La app está en modo desarrollo | Meta Developers → App Dashboard → **Publish / Go live** | La app podrá operar en modo público/live cuando cumpla requisitos de revisión |
| Falta visión completa de todas las cuentas | Business Manager → otorgar acceso a ambas cuentas al usuario/sistema que genera el token | El token podrá leer o gestionar ambas cuentas, incluida la cuenta `9523446201036125` |
| Faltan permisos API suficientes | Solicitar o confirmar `ads_read` y `ads_management` | Lectura de métricas y gestión programática de campañas/anuncios |
| Creatividades nuevas A1–A4 bloqueadas | App live + token con `ads_management` sobre la cuenta publicitaria | Reintento de creación de creatividades usando imágenes ya preparadas o hashes subidos |

## Permisos mínimos recomendados

Para dashboard y lectura integral de rendimiento, el token debe incluir **`ads_read`**. Para crear, pausar, editar campañas, conjuntos, anuncios o presupuestos, debe incluir **`ads_management`**. Meta documenta que `ads_management` permite leer y gestionar cuentas publicitarias que la app posee o a las que el propietario de la cuenta ha concedido acceso, incluido crear campañas, administrar anuncios y obtener métricas.[2] Meta también documenta que `ads_read` permite acceder a Ads Insights y enviar eventos de servidor a Facebook.[3]

| Objetivo operativo | Permiso/API | Nivel recomendado |
|---|---|---|
| Ver métricas, gasto, conversiones, campañas y anuncios | `ads_read` | Con acceso sobre ambas cuentas |
| Pausar campañas y cambiar presupuestos | `ads_management` | Con acceso sobre ambas cuentas |
| Crear creatividades y anuncios A1–A4 | `ads_management` | App en live + token autorizado |
| Usar varias cuentas de Business Manager con menor fricción | Marketing API Access Tier | Solicitar upgrade cuando proceda |

## Pasos en Meta Developers

Primero entra en [Meta Developers Apps](https://developers.facebook.com/apps/) y selecciona **NUVANX_SYSTEM**. En el panel de la app, revisa **App Review → Permissions and Features** y confirma que aparecen `ads_read`, `ads_management` y **Marketing API Access Tier**. Meta indica que el proceso de autorización de Marketing API verifica usuarios y apps, y que para gestionar anuncios normalmente se solicita `ads_management` junto con la característica Marketing API Access Tier.[4]

Después, ve a **Publish / Go live** y completa los requisitos que aparezcan en el panel. Si Meta exige revisión, envía la revisión con una explicación concreta del uso: lectura de métricas, creación/gestión de campañas propias de NUVANX y envío de eventos CAPI para atribución de leads. No solicites permisos innecesarios, porque Meta advierte que seleccionar permisos no requeridos suele ser una causa común de rechazo en revisión.[2]

## Pasos en Business Manager / Ads Manager

En [Meta Business Settings](https://business.facebook.com/settings/), confirma que la empresa **Nuvanx** tiene ambas cuentas publicitarias asignadas al mismo usuario administrador o al system user que genera el token. El acceso requerido debe ser de **administrador** o equivalente para poder cambiar presupuestos, pausar campañas y crear creatividades. Si una de las cuentas pertenece a otro Business Manager, el propietario debe compartirla con Nuvanx o conceder acceso al usuario que autoriza la app.

| Cuenta o identificador | Estado deseado | Uso previsto |
|---|---|---|
| `act_9523446201036125` | Acceso `ads_read` + `ads_management` | Pausar/duplicar campañas y gestionar campañas directas |
| Segunda cuenta Meta conectada en NUVANX | Acceso `ads_read` + `ads_management` | Visión completa cross-account y reporting consolidado |
| Pixel `1405503384615251` | Asociado a la cuenta y disponible en eventos | CAPI + atribución de leads landing |
| Google Ads `AW-18182220789` | Configurado en frontend | Atribución landing con `gclid` |

## Generación del token final

Una vez completado el acceso, genera un nuevo token desde [Graph API Explorer](https://developers.facebook.com/tools/explorer/) o desde un **system user** en Business Manager. El token debe incluir `ads_read` y `ads_management`, y debe estar emitido por la app **NUVANX_SYSTEM**. Después valida el token en [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) y confirma que aparecen ambas cuentas al consultar `/me/adaccounts`.

El token final debe permitir estas operaciones de comprobación antes de reintentar la creación A1–A4: lectura de campañas de ambas cuentas, lectura de insights, creación de campaña de prueba pausada, creación de creative y creación de anuncio pausado. Si cualquiera de estas comprobaciones falla, el bloqueo estará en permisos de Business Manager, revisión de app o nivel de acceso de Marketing API.

## Referencias

[1]: https://developers.facebook.com/docs/development/release "Meta for Developers — Release / Go Live"
[2]: https://developers.facebook.com/docs/permissions/reference/ads_management/ "Meta Permissions Reference — ads_management"
[3]: https://developers.facebook.com/docs/permissions/reference/ads_read/ "Meta Permissions Reference — ads_read"
[4]: https://developers.facebook.com/docs/marketing-api/overview/authorization/ "Meta Marketing API — Authorization"
