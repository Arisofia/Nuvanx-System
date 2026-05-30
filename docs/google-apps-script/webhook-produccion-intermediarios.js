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

// === CONFIGURACIÓN DE SEGURIDAD (recomendado) ===
// En Supabase Webhook, agrega un header personalizado:
//   X-Webhook-Secret: tu-clave-secreta-aqui
const EXPECTED_SECRET = "Doctoralia_Secret_2026_!!"; // Clave secreta para el header X-Webhook-Secret en Supabase

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

    const payload = JSON.parse(e.postData.contents);
    const record = payload.record; // Supabase envía el nuevo registro en "record"

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
    // (ver migración 20260513200000_create_produccion_intermediarios.sql)
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
      // "fecha_para_normalizar" no es una columna directa.
      // Usamos 'fecha' como valor más útil para esa posición.
      record.fecha || ""                      // L: fallback a 'fecha'
    ];

    // 4. Búsqueda por "Asunto" (columna F).
    // NOTA: Actualmente usamos "asunto" como clave única porque es lo que viene de Doctoralia.
    // Si en el futuro agregas un campo "id" más estable en la tabla, avísame y lo cambiamos
    // a record.id para mayor robustez.
    const data = sheet.getDataRange().getValues();
    const asuntoIndex = 5; // Columna F (0-based)
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][asuntoIndex]).trim() === String(record.asunto).trim()) {
        rowIndex = i + 1;
        break;
      }
    }

    // 5. Insertar o actualizar
    if (rowIndex !== -1) {
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
      console.log(`Fila actualizada (Asunto: ${record.asunto})`);
    } else {
      sheet.appendRow(rowData);
      console.log(`Nueva fila añadida (Asunto: ${record.asunto})`);
    }

    return ContentService
      .createTextOutput("OK")
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    console.error("Error procesando webhook:", err);
    // Devolvemos 200 igual para que Supabase no reintente infinitamente
    // (puedes cambiar la lógica si prefieres que reintente)
    return ContentService
      .createTextOutput("Error procesado")
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
          asunto: "Test Webhook - Paciente Ejemplo",
          agenda: "Dra. María",
          sala_box: "Box 3",
          confirmada: "Sí",
          procedencia: "Doctoralia",
          importe: 450,
          fecha_para_normalizar: "2026-05-27"
        }
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log("Resultado de prueba:", result.getContent());
}