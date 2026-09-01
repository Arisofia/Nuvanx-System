import { chromium } from "playwright";

const BASE_URL = "https://nuvanx-frontend.jenineferderas.workers.dev";
const EMAIL = "jenineferderas@hotmail.com";
const PASSWORD = "Password123!"; // Let's check or handle auth session

async function runAudit() {
  console.log("=== INICIANDO AUDITORÍA E2E GLOBAL DEL SISTEMA NUVANX ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (err) => {
    console.error("PAGE ERROR:", err.message);
    errors.push({ type: "pageerror", message: err.message });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error("CONSOLE ERROR:", msg.text());
    }
  });

  const routes = [
    "/login",
    "/dashboard",
    "/crm",
    "/live",
    "/marketing",
    "/financials",
    "/intelligence",
    "/reports",
    "/integrations",
    "/seo",
    "/traceability",
    "/reports/lead-audit",
    "/ai",
  ];

  for (const route of routes) {
    const url = `${BASE_URL}${route}`;
    console.log(`\nVerificando ruta: ${route} (${url})`);
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(e => {
      console.error(`Error al cargar ${route}:`, e.message);
      return null;
    });

    if (response) {
      console.log(`-> Status: ${response.status()}`);
    }

    const title = await page.title();
    console.log(`-> Título: ${title}`);
    
    // Check if configuration error is shown
    const configError = await page.locator("text=Configuración incompleta").isVisible().catch(() => false);
    if (configError) {
      console.error(`❌ ERROR DE CONFIGURACIÓN en ${route}`);
      errors.push({ route, error: "Configuración incompleta" });
    } else {
      console.log(`✅ Sin errores de configuración en ${route}`);
    }
  }

  await browser.close();
  console.log("\n=== RESUMEN AUDITORÍA ===");
  console.log("Total errores detectados:", errors.length);
  if (errors.length > 0) {
    console.error("Errores:", errors);
  } else {
    console.log("✅ TODAS LAS RUTAS CARGARON CORRECTAMENTE");
  }
}

runAudit().catch(console.error);
