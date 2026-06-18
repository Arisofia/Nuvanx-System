# NUVANX · Social Proof Activation · Doctoralia, Web, Google, Meta

## Objetivo

Activar la prueba social de NUVANX sin pagar Doctoralia PRO, usando solo evidencia pública verificable y activos propios.

El sistema debe:

1. Detectar reseñas públicas visibles en Doctoralia.
2. No afirmar cifras no verificadas públicamente.
3. Trasladar la prueba social a la web de NUVANX con copy compliance-safe.
4. Preparar copys para Meta Ads sin datos sensibles ni promesas médicas.
5. Preparar protocolo de captación de reseñas propias en Google Business Profile.
6. Evitar `AggregateRating` o `Review` schema engañoso en `LocalBusiness`.

## Estado público validado

URL revisada:

```text
https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser
```

Redirección pública observada:

```text
https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser-endolift
```

Contenido público observado:

- Clínica: `NUVANX Medicina Estética Láser/ ENDOLIFT`
- Especialidades: cirugía plástica, enfermería, medicina estética, medicina general
- Dirección pública: `Calle Fernández de la Hoz 4, Bajo Derecha, Madrid 28010`
- Equipamiento público listado: `Láser Médico`, `LaseMaR1500/Endolift`, `Láser Fraccionado CO2`, entre otros
- Registro sanitario: `CS20144`
- Responsable sanitario: `Dr. José Javier Rivera Tejeda`
- Opiniones públicas visibles: `1 opinión`
- Opinión pública visible: paciente `Lourdes`, `Cita verificada`, fecha `14 de octubre de 2025`, tratamiento `Tratamientos con Neurotoxina`

## Regla de seguridad

No usar en web, Meta Ads ni Google Business Profile la frase:

```text
93 reseñas verificadas en Doctoralia
```

hasta disponer de una fuente pública, export, captura o listado verificable que lo demuestre.

## Alternativa sin Doctoralia PRO

### 1. Usar la ficha pública como prueba externa

Copy web recomendado:

```text
Opiniones verificadas en Doctoralia

NUVANX cuenta con ficha pública en Doctoralia, donde las opiniones se muestran como verificadas por la plataforma. Consulta la experiencia publicada por pacientes antes de solicitar tu valoración médica.
```

CTA:

```text
Ver ficha en Doctoralia
```

### 2. Crear captación propia Google Business Profile

No copiar reseñas de Doctoralia a Google. El protocolo correcto es solicitar reseñas reales en Google tras visitas reales.

Texto WhatsApp post-visita:

```text
Gracias por visitarnos en NUVANX. Si tu experiencia fue positiva, nos ayudaría mucho que pudieras dejar una reseña en Google sobre tu valoración y atención en clínica.

No hace falta que menciones datos médicos personales. Solo tu experiencia real con el equipo, la claridad de la explicación y el trato recibido.

[ENLACE_RESEÑA_GOOGLE]
```

### 3. Meta Ads compliance-safe

No usar antes/después, defectos personales ni frases que impliquen inseguridad del usuario.

Copy recomendado:

```text
Pacientes de NUVANX destacan la claridad en la valoración médica, el trato discreto y el seguimiento posterior.

Medicina estética láser con dirección médica en Madrid.
Valoración médica gratuita en Chamberí o Goya.
```

Variación Endolift:

```text
Antes de indicar Endolift®, valoramos anatomía, piel, expectativas y recuperación.

NUVANX Medicina Estética Láser · Dirección médica · Madrid.
Valoración médica gratuita.
```

Variación láser médico:

```text
Tecnología LaseMaR1500, Smartlipo DEKA y láser CO2 fraccionado con indicación médica individual.

NUVANX · Chamberí y Goya / Barrio Salamanca.
```

## Implementación web recomendada

Archivo preparado:

```text
wp-mu-plugins/nuvanx-doctoralia-social-proof.php
```

Funciona como MU plugin. Añade:

- Shortcode `[nvx_doctoralia_social_proof]`.
- Bloque automático en Home, Medicina Estética Láser, Contacto y páginas clave.
- Copy seguro basado en fuente pública.
- Enlace externo a Doctoralia con `rel="nofollow noopener external"`.
- Sin `AggregateRating` schema.

## Implementación de extracción pública

Archivo preparado:

```text
scripts/social-proof/doctoralia-public-snapshot.mjs
```

Uso:

```bash
node scripts/social-proof/doctoralia-public-snapshot.mjs \
  --url "https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser" \
  --out tmp/doctoralia-public-snapshot.json
```

El script genera un snapshot local con:

- URL final tras redirección.
- Número de opiniones detectado públicamente.
- Nombre visible de la primera opinión pública.
- Fecha y tratamiento si están disponibles.
- Señales públicas de equipamiento y responsable sanitario.

## Criterio de activación

### Verde

Se puede activar:

- Bloque web con “opiniones verificadas en Doctoralia”.
- CTA hacia Doctoralia.
- Copys Meta Ads sin cifra de 93.
- Flujo de captación propia Google.

### Rojo

No activar todavía:

- “93 reseñas verificadas”.
- Rating agregado propio como schema.
- Copia masiva de nombres/textos de Doctoralia.
- Google reviews copiadas desde Doctoralia.

## Próximo paso operativo

1. Subir o sincronizar el MU plugin en `wp-content/mu-plugins/`.
2. Validar home/contacto/landing con curl.
3. Crear enlace directo de reseña Google Business Profile desde el panel de Google.
4. Cargar copys en Meta Ads manualmente o mediante integración propia si existe token operativo.
