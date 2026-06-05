/**
 * WEBHOOK PARA DOCTORALIA - SINCRONIZACIÓN SUPABASE
 *
 * Este script recibe webhooks de Supabase (Database Webhooks) y mantiene
 * la hoja "Doctoralia" actualizada en tiempo real (columnas A-L).
 *
 * Columnas M-T (ID, Nombre, Teléfono, Tratamiento, Día/Mes/Año, Clínica...)
 * se calculan automáticamente vía ARRAYFORMULA en la hoja (ver fórmulas
 * recomendadas en el README.md). El script NO las toca para preservarlas.
 */
const SHEET_NAME = "Doctoralia";
const SECRET_HEADER = "X-Webhook-Secret"; // Opcional pero recomendado

// === CONFIGURACIÓN DE SEGURIDAD ===
// Recomendado: Guardar el secreto en "Project settings → Script properties"
// Clave: WEBHOOK_SECRET
// Valor: (la misma clave que configuras en el Webhook de Supabase)
const EXPECTED_SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  try {
    // 1. Verificación de contenido
    if (!e || !e.postData || !e.postData.contents) return createResponse("No content", 400);

    // 2. Seguridad (solo si se configuró un secreto)
    if (EXPECTED_SECRET) {
      const headers = e.headers || {};
      const receivedSecret =
        e.parameter?.[SECRET_HEADER] ||
        headers[SECRET_HEADER] ||
        headers[SECRET_HEADER.toLowerCase()] ||
        headers['x-webhook-secret'] ||
        '';
      if (receivedSecret !== EXPECTED_SECRET) return createResponse("Unauthorized", 401);
    }

    const payload = JSON.parse(e.postData.contents);
    const record = payload.record; // Datos desde Supabase
    if (!record || !record.asunto) return createResponse("No record data", 400);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return createResponse("Sheet not found", 404);

    // 3. Mapeo de columnas A:L (solo estas se escriben vía script)
    // Las columnas M-T (ID, Nombre, Teléfono, Tratamiento, Día/Mes/Año, Clínica, etc.)
    // se gestionan con ARRAYFORMULA en la propia hoja (ver documentación en README
    // y sección de fórmulas recomendadas). Esto evita sobrescribir fórmulas al
    // hacer updates y mantiene la hoja ligera.
    const rowData = [
      record.estado || "Pendiente",       // A
      record.fecha || "",                // B
      record.hora || "",                 // C
      record.fecha_creacion || "",       // D
      record.hora_creacion || "",        // E
      record.asunto.trim(),              // F (Clave única)
      record.agenda || "",               // G
      record.sala_box || "Sin asignar",  // H
      record.confirmada || "",           // I
      record.procedencia || "-",         // J
      record.importe || 0,               // K
      record.fecha_para_normalizar || "" // L
    ];

    // 4. Lógica de Upsert (Evitar duplicados usando la columna F)
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === String(record.asunto).trim()) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex !== -1) {
      // Actualiza fila existente (Columnas A a L únicamente; M-T quedan intactas)
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Añade fila nueva (las fórmulas ARRAYFORMULA de M-T se expandirán solas)
      sheet.appendRow(rowData);
    }

    return createResponse("Success", 200);

  } catch (err) {
    return createResponse("Error: " + err.toString(), 500);
  }
}

function createResponse(message, code) {
  return ContentService.createTextOutput(JSON.stringify({
    status: message, code: code, timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Función de prueba manual (ejecuta desde el editor de Apps Script)
 * Úsala para probar que el mapeo A-L funciona y se inserta/actualiza la fila.
 * Después de ejecutar, revisa la hoja "Doctoralia":
 * - Columnas A-L deben actualizarse.
 * - Columnas M-T deben calcularse vía las ARRAYFORMULA que hayas puesto en fila 1.
 */
function testWebhook() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        record: {
          estado: "Pendiente",
          fecha: "2026-06-02",
          hora: "10:00",
          fecha_creacion: "2026-06-01",
          hora_creacion: "09:00",
          asunto: "000. PATIENT NAME [123456789] (TREATMENT)",
          agenda: "AGENDA NAME",
          sala_box: "BOX 1",
          confirmada: false,
          procedencia: "Source",
          importe: 100,
          fecha_para_normalizar: "2026-06-02"
        }
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log("Resultado de prueba:", result.getContent());
}
