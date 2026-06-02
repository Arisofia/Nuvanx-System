/**
 * WEBHOOK PARA DOCTORALIA - SINCRONIZACIÓN SUPABASE
 */
const SHEET_NAME = "Doctoralia";
const SECRET_HEADER = "X-Webhook-Secret";
const EXPECTED_SECRET = "Doctoralia_Secret_2026_!!"; 

function doPost(e) {
  try {
    // 1. Verificación de contenido
    if (!e || !e.postData || !e.postData.contents) return createResponse("No content", 400);

    // 2. Seguridad
    const headers = e.headers || {};
    const receivedSecret = headers[SECRET_HEADER] || headers[SECRET_HEADER.toLowerCase()];
    if (receivedSecret !== EXPECTED_SECRET) return createResponse("Unauthorized", 401);

    const payload = JSON.parse(e.postData.contents);
    const record = payload.record; // Datos desde Supabase
    if (!record || !record.asunto) return createResponse("No record data", 400);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return createResponse("Sheet not found", 404);

    // 3. Mapeo de columnas A:L
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
      // Actualiza fila existente (Columnas A a L únicamente)
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Añade fila nueva
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
