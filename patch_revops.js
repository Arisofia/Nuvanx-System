const fs = require('fs');
let code = fs.readFileSync('supabase/functions/revops-dispatcher/index.test.mjs', 'utf8');

code = code.replace(
  /it\("allowlists only governed RevOps workers including durable Meta CAPI and async WhatsApp", \(\) \=\> \{\n    expect\(source\)\.toContain\('"web-lead-reconcile"'\);\n    expect\(source\)\.toContain\('"deal-factory"'\);\n    expect\(source\)\.toContain\('"google-data-manager-export"'\);\n    expect\(source\)\.toContain\('"meta-capi-dispatch"'\);\n    expect\(source\)\.toContain\('"whatsapp-outbound-worker"'\);\n    expect\(source\)\.toContain\("if \(\!ALLOWED_WORKERS\.has\(worker\)\)"\);\n  \}\);/s,
  `it("allowlists only governed RevOps workers including durable Meta CAPI and async WhatsApp", () => {
    const match = source.match(/const ALLOWED_WORKERS = new Set\\(\\[([^\\]]+)\\]\\)/);
    expect(match).not.toBeNull();
    const workers = match[1].split(",").map(s => s.trim().replace(/"/g, ''));
    expect(workers).toEqual([
      "web-lead-reconcile",
      "deal-factory",
      "google-data-manager-export",
      "meta-capi-dispatch",
      "whatsapp-outbound-worker"
    ]);
    expect(source).toContain("if (!ALLOWED_WORKERS.has(worker))");
  });`
);

fs.writeFileSync('supabase/functions/revops-dispatcher/index.test.mjs', code);
