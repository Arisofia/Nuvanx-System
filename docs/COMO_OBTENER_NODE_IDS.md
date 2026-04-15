# Cómo Obtener Node IDs de Figma Make

## 🎯 Guía Rápida

Archivo Figma Make: `uJkwaJl7MIf5DE2VaqV8Vd`  
URL: https://www.figma.com/make/uJkwaJl7MIf5DE2VaqV8Vd

---

## Paso a Paso para Cada Pantalla

1. Abrir el archivo en Figma Make
2. Hacer click en el frame/slide correspondiente en el canvas
3. **Click derecho** → **"Copy link"**
4. El URL tendrá el formato:
   ```
   https://www.figma.com/make/uJkwaJl7MIf5DE2VaqV8Vd?node-id=XX-YY
   ```
5. Extraer `XX-YY` y convertir a `XX:YY` (guiones → dos puntos)
6. Actualizar en `docs/figma-component-map.json` el campo `figmaNodeId`

---

## 📋 Pantallas a Mapear

| Pantalla         | Route          | Archivo                                  | Node ID |
|------------------|----------------|------------------------------------------|---------|
| Login            | `/login`       | `frontend/src/pages/Login.jsx`           | ⏳ |
| Dashboard        | `/dashboard`   | `frontend/src/pages/Dashboard.jsx`       | ⏳ |
| Playbooks        | `/operativo`   | `frontend/src/pages/Playbooks.jsx`       | ⏳ |
| CRM              | `/crm`         | `frontend/src/pages/CRM.jsx`             | ⏳ |
| Live Dashboard   | `/live`        | `frontend/src/pages/LiveDashboard.jsx`   | ⏳ |
| Integrations     | `/integrations`| `frontend/src/pages/Integrations.jsx`    | ⏳ |
| AI Layer         | `/ai`          | `frontend/src/pages/AILayer.jsx`         | ⏳ |

## 🧩 Componentes a Mapear

| Componente       | Archivo                                          | Node ID |
|------------------|--------------------------------------------------|---------|
| MetricCard       | `frontend/src/components/MetricCard.jsx`         | ⏳ |
| FunnelChart      | `frontend/src/components/FunnelChart.jsx`        | ⏳ |
| TopNav           | `frontend/src/components/TopNav.jsx`             | ⏳ |
| IntegrationCard  | `frontend/src/components/IntegrationCard.jsx`    | ⏳ |
| Layout           | `frontend/src/components/Layout.jsx`             | ⏳ |
| Sidebar          | `frontend/src/components/Sidebar.jsx`            | ⏳ |

---

## ⚠️ Formato de Conversión

**IMPORTANTE**: El URL usa guiones, el JSON usa dos puntos.

| Desde URL        | Para JSON        |
|------------------|------------------|
| `node-id=1-2`    | `"1:2"`          |
| `node-id=12-34`  | `"12:34"`        |
| `node-id=123-456`| `"123:456"`      |

---

## 📝 Plantilla de Trabajo

```
Login
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

Dashboard
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

Playbooks
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

CRM
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

Live Dashboard
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

Integrations
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 

AI Layer
  URL: 
  node-id (XX-YY): 
  figmaNodeId (XX:YY): 
```

---

## ✅ Verificación

Después de actualizar los node IDs en `figma-component-map.json`:

```bash
node scripts/validate-figma-mapping.mjs
```

Los 13 warnings de "placeholder node ID" deberían desaparecer.

---

## 🔄 Alternativa: Migrar a Figma Design

Si en el futuro quieres sync automático vía API:

1. Crear un nuevo archivo Figma tipo **Design** (no Make)
2. Copiar/exportar los frames desde el Make
3. Actualizar `fileKey` en `figma-component-map.json`
4. Los node IDs se pueden obtener automáticamente via `GET /v1/files/:key`

**Ventajas**: sync automático de tokens, detección de cambios, integración CI/CD.

---

## ❓ FAQ

**¿Por qué no funciona la API con Figma Make?**  
Figma Make usa una estructura diferente para aplicaciones interactivas; la REST API solo soporta archivos Design.

**¿El URL no tiene `node-id=`?**  
Necesitas hacer click en el frame específico en el canvas antes de copiar el link.
