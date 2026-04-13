# 🔧 Configuración de Supabase — Nuvanx

## ¿Por qué Supabase?

Actualmente, las credenciales de integraciones (HubSpot, Meta, Gmail, etc.) se guardan
**solo en localStorage** del navegador, lo que significa:

❌ Se pierden al cambiar de navegador  
❌ No se sincronizan entre dispositivos  
❌ No están disponibles para otros usuarios del equipo  
❌ Se pierden al limpiar caché

Con Supabase, las credenciales:

✅ **Se sincronizan** entre todos tus dispositivos  
✅ **Persisten** en la nube de forma segura  
✅ **Se cargan** automáticamente al iniciar sesión  
✅ **Funcionan** en cualquier navegador

---

## 📋 Paso 1: Crear Proyecto en Supabase

### 1.1. Registrarse en Supabase

1. Ve a [supabase.com](https://supabase.com)
2. Click en **"Start your project"**
3. Crea una cuenta con GitHub o email

### 1.2. Crear Nuevo Proyecto

1. Click en **"New Project"**
2. Configura:
   - **Name**: `nuvanx-prod` (o el nombre que prefieras)
   - **Database Password**: Una contraseña fuerte (guárdala)
   - **Region**: `Europe West (Frankfurt)` (o la más cercana)
   - **Pricing Plan**: `Free` (incluye 500 MB DB + 1 GB bandwidth)
3. Click **"Create new project"**
4. Espera 2–3 minutos mientras se aprovisiona

---

## 📋 Paso 2: Ejecutar SQL para Crear Tablas

### 2.1. Abrir SQL Editor

1. En el panel izquierdo, click en **"SQL Editor"**
2. Click en **"+ New query"**

### 2.2. Copiar y Ejecutar Script

1. Abre el archivo `frontend/src/lib/supabase/database.sql` en este proyecto
2. Copia **TODO** el contenido
3. Pégalo en el SQL Editor de Supabase
4. Click en **"Run"** (esquina inferior derecha)

Deberías ver:

```
Success. No rows returned
```

### 2.3. Verificar que se Crearon las Tablas

1. En el panel izquierdo, click en **"Table Editor"**
2. Deberías ver 2 tablas:
   - `user_integrations` — Estado de conexión de cada integración por usuario
   - `user_credentials` — Credenciales API cifradas (AES-256-GCM)

---

## 📋 Paso 3: Obtener las Credenciales de API

### 3.1. Ir a Project Settings → API

1. En el panel izquierdo, click en **"Project Settings"** (ícono de engranaje)
2. Click en la sección **"API"**

### 3.2. Copiar los Valores

Necesitas dos valores:

| Variable | Dónde encontrarla |
|---|---|
| `VITE_SUPABASE_URL` | Campo **"Project URL"** |
| `VITE_SUPABASE_ANON_KEY` | Sección **"Project API keys"** → `anon` `public` |

> ⚠️ **NUNCA** uses la clave `service_role` en el frontend. Solo usa `anon`.

---

## 📋 Paso 4: Configurar Variables de Entorno

### 4.1. Crear archivo `.env.local`

En la raíz de la carpeta `frontend/`, crea el archivo `.env.local`:

```bash
# frontend/.env.local
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Reemplaza los valores con los que copiaste en el Paso 3.

### 4.2. Para el Backend (opcional — si usas Supabase como BD principal)

En `backend/.env`:

```bash
DATABASE_URL=postgresql://postgres:[tu-contraseña]@db.[tu-proyecto].supabase.co:5432/postgres
```

La `DATABASE_URL` completa se encuentra en:  
**Project Settings → Database → Connection string → URI**

> 💡 El backend de Nuvanx ya soporta Supabase/PostgreSQL de forma nativa.
> Cuando `DATABASE_URL` está configurado, usa la BD en la nube automáticamente.
> Sin ella, usa almacenamiento en memoria (solo para desarrollo local).

---

## 📋 Paso 5: Instalar la Librería de Supabase

```bash
cd frontend
npm install @supabase/supabase-js
```

---

## 📋 Paso 6: Verificar la Integración

Reinicia el servidor de desarrollo:

```bash
cd frontend
npm run dev
```

Si la configuración es correcta, en la consola del navegador **no verás** el aviso:

```
[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.
```

---

## 🔒 Seguridad

- Las credenciales de API (HubSpot, Meta, etc.) se cifran con **AES-256-GCM** antes de guardarse en Supabase.
- La clave de cifrado reside en el servidor (variable `ENCRYPTION_KEY`) y nunca llega al navegador.
- Supabase **Row Level Security (RLS)** está activado: cada usuario solo puede ver y modificar sus propios registros.
- La clave `anon` del frontend solo puede acceder a registros del usuario autenticado (gracias a las políticas RLS).

---

## 🛠️ Estructura de Archivos Relevantes

```
frontend/src/lib/supabase/
├── client.js        # Singleton del cliente Supabase
└── database.sql     # Script SQL para crear las tablas en Supabase

backend/src/db/
├── index.js                         # Pool de conexión PostgreSQL
└── migrations/
    └── 001_initial_schema.sql       # Esquema completo del backend
```

---

## ❓ Preguntas Frecuentes

**¿Tengo que usar Supabase obligatoriamente?**  
No. La aplicación funciona sin Supabase usando almacenamiento en memoria (para dev local)
o cualquier base de datos PostgreSQL. Supabase es la opción recomendada para producción.

**¿Qué pasa si no configuro `VITE_SUPABASE_URL`?**  
La aplicación funciona normalmente pero no persiste credenciales en la nube.
Verás un aviso en la consola del navegador.

**¿Puedo usar el plan gratuito de Supabase en producción?**  
Sí, para equipos pequeños. El plan gratuito incluye 500 MB de base de datos,
1 GB de ancho de banda, y se escala a planes de pago si necesitas más.
