# NUVANX · Google Business Profile Review Activation

## Objetivo

Activar captación propia de reseñas en Google Business Profile para NUVANX sin copiar reseñas de Doctoralia, sin incentivos y sin sesgar la valoración.

## Base normativa de Google

Google permite pedir reseñas a clientes reales mediante enlace o código QR. La propia ayuda de Perfil de Empresa recomienda incluir el enlace en recibos, emails de agradecimiento, chats y QR en clínica.

Google prohíbe:

- Reseñas incentivadas con descuentos, pagos, productos o servicios gratuitos.
- Pedir solo reseñas positivas.
- Presionar al paciente para escribir mientras está en clínica.
- Indicar contenido específico obligatorio.
- Publicar reseñas que no reflejen experiencia auténtica.

## Configuración necesaria

NUVANX debe obtener desde Google Business Profile dos enlaces directos de reseña:

```text
GOOGLE_REVIEW_CHAMBERI_URL=
GOOGLE_REVIEW_GOYA_URL=
```

Ruta en Google:

```text
business.google.com → Perfil de Empresa → Leer reseñas → Conseguir más reseñas → Copiar enlace
```

Para QR:

```text
business.google.com → Perfil de Empresa → Leer reseñas → Conseguir más reseñas → Descargar QR
```

## Mensaje WhatsApp post-visita

### General

```text
Gracias por visitarnos en NUVANX.

Si tu experiencia fue positiva, nos ayudaría mucho que pudieras dejar una reseña en Google sobre tu valoración y atención en clínica.

No hace falta que menciones datos médicos personales. Solo tu experiencia real con el equipo, la claridad de la explicación y el trato recibido.

[ENLACE_RESEÑA_GOOGLE]
```

### Chamberí

```text
Gracias por visitarnos en NUVANX Chamberí.

Si tu experiencia fue positiva, nos ayudaría mucho que pudieras dejar una reseña en Google sobre tu valoración y atención en clínica.

No hace falta que menciones datos médicos personales. Solo tu experiencia real con el equipo, la claridad de la explicación y el trato recibido.

[GOOGLE_REVIEW_CHAMBERI_URL]
```

### Goya

```text
Gracias por visitarnos en NUVANX Goya · Barrio Salamanca.

Si tu experiencia fue positiva, nos ayudaría mucho que pudieras dejar una reseña en Google sobre tu valoración y atención en clínica.

No hace falta que menciones datos médicos personales. Solo tu experiencia real con el equipo, la claridad de la explicación y el trato recibido.

[GOOGLE_REVIEW_GOYA_URL]
```

## Web activation

Archivo preparado:

```text
wp-mu-plugins/nuvanx-google-review-request.php
```

El MU plugin añade:

- Shortcode `[nvx_google_review_request]`.
- Bloque automático solo si hay al menos un enlace Google configurado.
- Botón Chamberí si existe `NVX_GOOGLE_REVIEW_CHAMBERI_URL` o la opción `nvx_google_review_chamberi_url`.
- Botón Goya si existe `NVX_GOOGLE_REVIEW_GOYA_URL` o la opción `nvx_google_review_goya_url`.
- Copy compliance-safe.
- Sin incentivos.
- Sin pedir contenido concreto.

## WP-CLI setup

Cuando tengas los links reales:

```bash
wp option update nvx_google_review_chamberi_url 'PEGAR_LINK_GOOGLE_CHAMBERI'
wp option update nvx_google_review_goya_url 'PEGAR_LINK_GOOGLE_GOYA'
```

Luego purgar caché:

```bash
wp cache flush
wp sg purge
```

## Dónde insertar el bloque

Automático en:

- Contacto
- Equipo Médico
- Home
- Clínicas / ubicación

No se inserta en páginas comerciales de tratamiento hasta tener volumen real de reseñas Google suficiente.

## Indicador de cierre

```text
GOOGLE_REVIEW_BLOCK>=1
GOOGLE_REVIEW_LINKS>=1
FALSE_INCENTIVE_COUNT=0
NOINDEX_COUNT=0
PHPERR_COUNT=0
VALIDATION_FAIL=0
```

## No hacer

- No importar reseñas Doctoralia a Google.
- No escribir reseñas por pacientes.
- No ofrecer descuentos por reseña.
- No pedir cinco estrellas.
- No pedir mencionar tratamiento concreto.
- No usar nombres completos de pacientes en web sin consentimiento explícito.
