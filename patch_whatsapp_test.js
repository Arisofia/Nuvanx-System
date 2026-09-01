const fs = require('fs');
let code = fs.readFileSync('supabase/functions/whatsapp-send/index.test.mjs', 'utf8');

const oldCheck = `  it("handles missing payload table gracefully for fresh deployments", () => {
    expect(source).toContain('try {');
    expect(source).toContain('const { data: payloadRows, error: payloadError }');
    expect(source).toContain('if (!payloadError)');
    expect(source).toContain('} catch');
    expect(source).toContain('hasPayload = false');
  });`;

const newCheck = `  it("handles missing payload table gracefully for fresh deployments", () => {
    const tryBlock = boundedSlice(source, 'try {', 'catch (error: any)');
    expect(tryBlock).toContain('const { data: payloadRows, error: payloadError } = await auth.admin');
    expect(tryBlock).toContain('.from("whatsapp_outbound_payloads")');
    expect(tryBlock).toContain('if (!payloadError) {');
    expect(tryBlock).toContain('hasPayload = Array.isArray(payloadRows) && payloadRows.length > 0;');
    expect(tryBlock).toContain('else if (payloadError.code === "42P01" || payloadError.message?.includes("does not exist")) {');
    expect(tryBlock).toContain('hasPayload = false;');

    const catchBlock = boundedSlice(source, 'catch (error: any)', 'if (!hasPayload) {');
    expect(catchBlock).toContain('if (error?.code === "42P01" || error?.message?.includes("does not exist")) {');
    expect(catchBlock).toContain('hasPayload = false;');
    expect(catchBlock).toContain('return json({ success: false, message: \`Unexpected error checking outbound payload\` }, 500);');
  });`;

code = code.replace(oldCheck, newCheck);
fs.writeFileSync('supabase/functions/whatsapp-send/index.test.mjs', code);
