# NUVANX RevOps Attribution Contract v1

**Estado:** contrato canónico de implementación y auditoría  
**Fecha:** 2026-08-23  
**Repositorio:** `Arisofia/Nuvanx-System`

## 1. Alcance y fuente de verdad

Este documento consolida el contrato que ya está representado en las migraciones y funciones de `supabase/` y en el código de atribución de WordPress. Su objetivo es evitar que la atribución, la reconciliación de leads, el Deal Factory, el SLA y las conversiones publicitarias evolucionen como flujos paralelos.

La fuente primaria del evento operativo es `web_lead_captures`, creado por un envío web/HubSpot canónico. La función `web-lead-reconcile` valida el contacto HubSpot asociado a `nvx_lead_id`, crea o recupera el lead operativo de Supabase mediante una restricción única y llama a `finalize_web_capture_reconciliation`. El dispatcher posterior procesa las proyecciones y outboxes. Los eventos de Google y Doctoralia son complementarios o de reconciliación; no crean por sí solos el lead web ni el Deal.

## 2. Contrato de almacenamiento de atribución

La decisión canónica es la siguiente:

| Dato | Almacenamiento | Duración | Semántica |
|---|---|---:|---|
| `nvx_first_touch` | `localStorage` | 90 días | Primer touch no interno capturado con consentimiento de marketing. |
| `nvx_conversion_touch` | `localStorage` | 90 días | Touch activo de conversión; se actualiza para tráfico externo y se conserva para tráfico interno/directo si aún no existe. |
| `nvx_lead_id` | `sessionStorage` | Sesión del navegador | UUID v4 de la sesión/episodio de captura. No representa una identidad eterna del contacto ni sustituye `public.leads.id`. |
| `google_click_attributions.nvx_lead_id` | Supabase | Retención operativa | Une una captura de clic con el episodio web y solo se convierte en `applied_lead_id` después de reconciliación. |
| `leads.nvx_lead_id` | Supabase | Retención operativa | Identificador único del episodio lógico de lead/submission. Tiene índice único mientras el lead no esté eliminado. |

El código canónico existente confirma esta separación: `nvx-attribution-contract.js` utiliza `localStorage` para first touch y conversion touch, y `sessionStorage` para `nvx_lead_id`. No se deben migrar ambos datos al mismo almacén sin una decisión de privacidad y retención nueva.

Un nuevo envío dentro de la misma sesión conserva el `nvx_lead_id` del episodio actual. La idempotencia del envío no depende únicamente del navegador: se aplica en Supabase mediante la unicidad de `leads.nvx_lead_id`, `web_lead_captures`, `google_data_manager_outbox.transaction_id` y `hubspot_deal_projections.lead_id`.

## 3. Consentimiento y limitación de finalidad

El código debe capturar y transmitir atribución solo cuando WordPress confirma consentimiento de marketing. La captura operativa de un lead y su eventual Deal no depende del consentimiento de marketing. Sin embargo, la aplicación de atribución Google y la creación de eventos para Google Data Manager requieren `marketing_consent=true` en la captura canónica.

Los leads QA se identifican con `nvx_is_test_lead=true` y, opcionalmente, `nvx_test_run_id`. Un lead QA no puede crear Deal, no puede iniciar SLA operativo, no puede generar Meta CAPI y no puede generar una conversión offline de Google. La supresión se aplica en la reconciliación de Supabase y no se deja a la disciplina del test.

## 4. Contrato de reconciliación

`web-lead-reconcile` es el reconciliador autorizado. Requiere credencial de service role, busca capturas sin `applied_lead_id` en estado `pending`, `failed` o `qa_suppressed`, y realiza estas comprobaciones antes de finalizar:

1. `nvx_lead_id` debe ser UUID v4 válido.
2. El contacto HubSpot debe ser único para ese `nvx_lead_id`.
3. El hash de email de HubSpot debe coincidir con el hash de la captura cuando exista.
4. El contacto QA debe suprimirse antes de cualquier downstream.
5. El lead Supabase debe tener `source=website_hubspot` y el mismo `nvx_lead_id`.
6. Una atribución Google no puede estar aplicada a otro lead.
7. La finalización debe ser atómica mediante `finalize_web_capture_reconciliation`.

Los estados contractuales de captura son `pending`, `failed`, `qa_suppressed`, `reconciled` y `conflict`. Un conflicto de identidad no debe reintentarse ciegamente; requiere revisión.

## 5. Deal Factory

El evento canónico de entrada es una reconciliación web HubSpot exitosa. `finalize_web_capture_reconciliation` crea o actualiza exactamente una fila en `hubspot_deal_projections` por `lead_id`, con estado `pending`. Un worker autorizado transforma la proyección en un Deal HubSpot y persiste `hubspot_deal_id` de forma idempotente.

La unicidad contractual es `hubspot_deal_projections.lead_id`, no la existencia informal de un Deal abierto. Un reenvío del mismo webhook o una ejecución simultánea debe converger en la misma proyección. Una nueva valoración meses después debe tener un nuevo `nvx_lead_id` y, por tanto, puede ser un nuevo episodio comercial; no debe sobrescribir el episodio anterior solo porque coincida el contacto.

La migración actual contiene valores por defecto para `pipeline_id=3707782370` y `stage_id=5159669951`. Estos son valores de configuración versionados, no evidencia de que el portal HubSpot los acepte actualmente. Antes de habilitar creación real de Deals se deben verificar mediante HubSpot sus pipelines, etapas, owner permitido y permisos de escritura.

## 6. SLA

`first_response_at` significa el primer mensaje de WhatsApp enviado y aceptado por el proveedor, iniciado por un humano autenticado propietario del lead. No significa la primera respuesta del paciente ni un envío automatizado o una plantilla. La función autorizada es `mark_lead_human_first_response(lead_id, user_id, sent_at)`.

El SLA por defecto es de 30 minutos, con un rango permitido de 1 a 1440 minutos. La vista `vw_lead_sla` calcula `pending`, `met` o `breached` usando `created_at + first_response_sla_minutes`. La implementación no debe registrar una respuesta al crear el contacto ni al enviar tráfico automatizado.

## 7. Doctoralia

Doctoralia es una fuente de citas y revenue reconciliado, no la fuente primaria de creación del lead web. El motor existente empareja por teléfono normalizado o hash telefónico, conserva una coincidencia primaria por lead y actualiza el estado operativo con el vocabulario vigente (`lead`, `appointment`, `convertido`). Los estados de asistencia viven en los campos dedicados de la cita.

La dependencia que todavía exige validación externa es el acceso real a la API o exportación disponible de Doctoralia, sus permisos y la procedencia de cada `source_key`. No se debe declarar integración API completa solo porque el modelo de ingestión y el motor de matching existan en el repositorio.

## 8. Google y Meta

Google Data Manager se alimenta mediante `google_data_manager_outbox`. Cada evento usa `transaction_id` único y la función de cola exige una atribución reconciliada, no QA y vinculada al mismo lead. Los estados son `pending`, `sending`, `sent`, `failed`, `suppressed` y `configuration_required`.

Meta CAPI y Google offline conversions deben ejecutarse server-side, con credenciales en secretos y sin transmitir diagnóstico, zona corporal, mensajes ni otros datos clínicos. La entrega debe ser opt-in por consentimiento, deduplicada por el identificador de evento/transacción y observable mediante estados de outbox. La existencia de código de Meta en `api/index.ts` no demuestra por sí sola que las credenciales, datasets, conversion actions y permisos productivos estén verificados.

## 9. QA y aceptación

La regla única es: `nvx_is_test_lead=true` nunca genera Deal, SLA, Meta CAPI ni Google offline conversion. El test de aceptación debe validar que el formulario recibe `nvx_lead_id`, que el lead QA se marca, que la reconciliación devuelve `qa_suppressed` y que no aparecen filas downstream. Un entorno sandbox separado puede probar un proveedor real, pero no debe reutilizar el contrato de QA productivo.

La batería E2E mínima debe comprobar:

| Caso | Resultado esperado |
|---|---|
| Primera visita con UTMs y consentimiento | Se persiste first touch en `localStorage`; el formulario recibe campos normalizados. |
| Visita posterior directa | Se conserva first touch y se usa el touch de conversión vigente. |
| Envío normal | Se genera UUID v4 de sesión; Supabase reconcilia una captura y una proyección de Deal. |
| Envío QA | Se marca `qa_suppressed`; no hay Deal, SLA ni conversiones. |
| Reintento del mismo evento | No se duplica lead, proyección ni evento Google. |
| Dos episodios del mismo contacto | Cada episodio válido mantiene su propio `nvx_lead_id`; la política comercial decide si se crea un nuevo Deal. |
| Primera respuesta humana | Solo el evento autorizado fija `first_response_at`; automatizaciones no lo fijan. |
| Sin consentimiento de marketing | Puede existir lead operativo, pero no se aplica atribución Google ni se encola feedback publicitario. |

## 10. Evidencia pendiente antes del cierre integral

La implementación local contiene los contratos estructurales principales, pero el cierre integral todavía requiere evidencia directa de:

- estado real de `master` frente a producción y staging2;
- propiedades HubSpot por `internalName`, tipo y opciones;
- formulario canónico y formularios legacy;
- workflows que puedan duplicar Deal Factory;
- pipelines, etapas y owner productivos;
- permisos efectivos de escritura en HubSpot;
- proyecto Supabase, migraciones aplicadas y estado real de Vault/Edge Functions;
- credenciales y permisos reales de Meta CAPI y Google Data Manager;
- disponibilidad y permisos de Doctoralia API o exportación;
- ejecución E2E completa con PHP y navegador;
- rotación de credenciales históricas y necesidad de purga de refs Git.

Estas dependencias son verificaciones externas. No se deben sustituir por inferencias derivadas del código fuente.
