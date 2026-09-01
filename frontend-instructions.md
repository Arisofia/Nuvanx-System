# Instrucciones para el equipo Frontend: Captura y Envío de GCLID

## Problema Actual (Error E6)

El pipeline de atribución `google-click-attribution` en el backend (Supabase Edge Functions) está funcionando correctamente y está estructuralmente sano. Sin embargo, no está recibiendo identificadores GCLID en los envíos de formularios.

La causa raíz es que el GCLID solo existe en la URL cuando el usuario hace clic en el anuncio y aterriza en la página. Si el usuario aún no ha aceptado el consentimiento de marketing en ese momento (que es el caso para nuevos visitantes), el frontend actualmente no captura el GCLID. Cuando finalmente envían el formulario, el GCLID ya se ha perdido o no se incluye en el payload.

## Solución Requerida

El frontend debe preservar temporalmente el GCLID y enviarlo con el payload del formulario, respetando las preferencias de consentimiento del usuario.

### Pasos de Implementación

1. **Captura en el Carga de Página:**
   Al cargar *cualquier* página, analizar la URL buscando el parámetro `gclid`.

   ```javascript
   const urlParams = new URLSearchParams(window.location.search);
   const gclid = urlParams.get('gclid');
   ```

2. **Almacenamiento Temporal Seguro:**
   Si se encuentra un `gclid`, guárdelo en `sessionStorage` (o una cookie *first-party* estrictamente necesaria para el funcionamiento de la sesión, no para rastreo de terceros). **No lo envíe al backend todavía si no hay consentimiento.**

   ```javascript
   if (gclid) {
       sessionStorage.setItem('temp_gclid', gclid);
   }
   ```

3. **Inclusión en el Payload del Formulario:**
   Al momento de que el usuario envíe un formulario de contacto o registro (ej. agendar cita), recupere el GCLID almacenado.

   ```javascript
   const storedGclid = sessionStorage.getItem('temp_gclid');
   ```

4. **Verificación de Consentimiento y Envío:**
   *Solo* incluya el GCLID en el cuerpo de la petición POST si el usuario ha aceptado explícitamente el consentimiento de marketing (`marketing_consent === true`).

   ```javascript
   const payload = {
       name: formData.name,
       email: formData.email,
       // ... otros datos del formulario
   };

   // La lógica crucial:
   if (userConsentedToMarketing && storedGclid) {
       payload.gclid = storedGclid;
   }

   // Enviar payload al backend
   ```

5. **Limpieza (Opcional pero recomendado):**
   Después de un envío exitoso, puede limpiar el GCLID de `sessionStorage`.

La Edge Function `google-click-attribution` ya está configurada para recibir y procesar este campo `gclid` cuando llegue en el payload del formulario.
