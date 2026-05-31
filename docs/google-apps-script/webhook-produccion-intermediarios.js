/**
 * Google Apps Script - Webhook para sincronizar Supabase → Google Sheets
 * Tabla: "Produccion Intermediarios"
 *
 * Este script recibe webhooks de Supabase (Database Webhooks) y mantiene
 * la hoja de Google Sheets actualizada en tiempo real.
 *
 * Mejoras de robustez incluidas:
 * - Manejo de errores con try/catch
 * - Validación de payload
 * - Búsqueda por "Asunto" como clave única (idempotente)
 * - Soporte para header de secreto (recomendado)
 * - Logging claro para depuración (ver en "Ejecuciones")
 * - No sincroniza campos internos como capi_sent (a menos que lo quieras)
 */

const SHEET_NAME = "Produccion Intermediarios";
const SECRET_HEADER = "X-Webhook-Secret"; // Opcional pero recomendado

// === CONFIGURACIÓN DE SEGURIDAD ===
// Recomendado: Guardar el secreto en "Project settings → Script properties"
// Clave: WEBHOOK_SECRET
// Valor: (la misma clave que configuras en el Webhook de Supabase)
const EXPECTED_SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  try {
    // 1. Validación básica del request
    if (!e || !e.postData || !e.postData.contents) {
      console.error("Webhook recibido sin contenido");
      return ContentService.createTextOutput("Bad Request: No content").setMimeType(ContentService.MimeType.TEXT);
    }

    // 2. Verificación de secreto (si está configurado)
    if (EXPECTED_SECRET) {
      const receivedSecret = e.parameter[SECRET_HEADER] || (e.headers && e.headers[SECRET_HEADER]);
      if (receivedSecret !== EXPECTED_SECRET) {
        console.warn("Intento de webhook no autorizado");
        return ContentService.createTextOutput("Unauthorized").setMimeType(ContentService.MimeType.TEXT);
      }
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      console.error("Error parseando JSON del webhook:", parseErr);
      return ContentService.createTextOutput("Bad Request: Invalid JSON").setMimeType(ContentService.MimeType.TEXT);
    }

    const record = payload.record;

    if (!record) {
      console.error("Payload sin campo 'record'");
      return ContentService.createTextOutput("Bad Request: No record").setMimeType(ContentService.MimeType.TEXT);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      console.error(`La hoja "${SHEET_NAME}" no existe`);
      return ContentService.createTextOutput("Sheet not found").setMimeType(ContentService.MimeType.TEXT);
    }

    // 3. Mapeo basado en la definición real de la tabla produccion_intermediarios
    // (ver migración 20260530205600_extend_produccion_intermediarios_v2.sql)
    const rowData = [
      record.estado || "",                    // A: estado
      record.fecha || "",                     // B: fecha
      record.hora || "",                      // C: hora
      record.fecha_creacion || "",            // D: fecha_creacion
      record.hora_creacion || "",             // E: hora_creacion
      record.asunto || "",                    // F: asunto (CLAVE ÚNICA - usada para deduplicar)
      record.agenda || "",                    // G: agenda
      record.sala_box || "",                  // H: sala_box
      record.confirmada || false,             // I: confirmada (BOOLEAN)
      record.procedencia || "",               // J: procedencia
      record.importe || 0,                    // K: importe
      record.fecha_para_normalizar || record.fecha || "", // L: fecha_para_normalizar
      record.doc_patient_id || "",            // M: ID
      record.paciente_nombre || "",           // N: Nombre
      record.telefono_original || "",         // O: Teléfono
      record.procedimiento_nombre || "",      // P: Tratamiento
      record.tipo_cliente || "",              // Q: Tipo de Cliente
      record.email_hubspot || "",             // R: Email HubSpot
      record.ejecutivo_asignado || "",        // S: EJECUTIVO ASIGNADO
      record.ingreso_lead || "",              // T: INGRESO DEL LEAD
      record.campana || ""                    // U: CAMPAÑA
    ];

    // 4. Búsqueda por "Asunto" (columna F) - clave única.
    // Optimizado: usamos find() en lugar de recorrer todo manualmente.
    const data = sheet.getDataRange().getValues();
    const asuntoIndex = 5; // Columna F (0-based)
    const targetAsunto = String(record.asunto || '').trim();

    const rowIndex = data.findIndex((row, idx) => idx > 0 && String(row[asuntoIndex]).trim() === targetAsunto);
    const foundRow = rowIndex !== -1 ? rowIndex + 1 : -1;

    // 5. Insertar o actualizar
    if (foundRow !== -1) {
      // Para actualizaciones, preservamos las fórmulas de las columnas V, W, X si existen
      sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
      console.log(`Fila actualizada (Asunto: ${record.asunto})`);
    } else {
      // Para nuevas filas, añadimos las fórmulas de Día, Mes, Año (V, W, X)
      const nextRow = sheet.getLastRow() + 1;
      rowData.push(`=DAY(B${nextRow})`);   // V: Día
      rowData.push(`=MONTH(B${nextRow})`); // W: Mes
      rowData.push(`=YEAR(B${nextRow})`);  // X: Año
      sheet.appendRow(rowData);
      console.log(`Nueva fila añadida (Asunto: ${record.asunto})`);
    }

    return ContentService
      .createTextOutput("OK")
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    console.error("Error procesando webhook:", err, err.stack);
    // Importante: Seguimos devolviendo 200 para evitar que Supabase reintente infinitamente.
    // Los errores quedan registrados en "Ejecuciones" de Apps Script.
    // Si quieres que Supabase reintente en caso de error, cambia a return con código 500.
    return ContentService
      .createTextOutput("Error procesado (ver logs)")
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Función de prueba manual (ejecuta desde el editor de Apps Script)
 * Úsala para probar que el mapeo de columnas funciona.
 */
function testDoPost() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        record: {
          estado: "Pagada",
          fecha: "2026-05-27",
          hora: "10:30",
          fecha_creacion: "2026-05-20",
          hora_creacion: "09:15",
          asunto: "292. Aymara KB Luizaga Revaldería [657607191] (INDUTOR DE COLAGENOS...)",
          agenda: "MEDICINA ESTÉTICA JJRT",
          sala_box: "BOX 1",
          confirmada: true,
          procedencia: "Doctoralia",
          importe: 450,
          fecha_para_normalizar: "2026-05-27",
          doc_patient_id: "292",
          paciente_nombre: "Aymara KB Luizaga Revaldería",
          telefono_original: "657607191",
          procedimiento_nombre: "INDUTOR DE COLAGENOS",
          tipo_cliente: "Cliente nuevo",
          email_hubspot: "aymara@example.com",
          ejecutivo_asignado: "Jeninefer Deras",
          ingreso_lead: "46101.77",
          campana: "Laser CO2"
        }
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log("Resultado de prueba:", result.getContent());
}
