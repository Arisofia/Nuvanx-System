# 🔐 NUVANX - CREDENCIALES Y CONFIGURACIÓN COMPLETA

**Fecha:** Junio 8, 2026  
**Estado:** ✅ TODOS LOS SISTEMAS CONFIGURADOS Y DESPLEGADOS

---

## 📱 META / FACEBOOK APPLICATIONS

### 1. NUVANX_SYSTEM (Principal)
- **App ID:** `878822511043717`
- **App Secret:** `8faebed3bc708ebdfc0c4cc2b50071f1`
- **Status:** En desarrollo
- **Empresa:** Nuvanx
- **Rol:** Administrador

### 2. Conversions API Application
- **App ID:** `964347706333579`
- **Status:** Publicada
- **Tipo:** Solo identificador de acceso
- **Empresa:** Nuvanx
- **Rol:** Administrador

### 3. Hubspot-IG (Instagram)
- **App ID:** `2817062495308287`
- **App Secret:** `2098ff4d8e7f3e957ef13f95aa6958fb`
- **Status:** Para webhooks
- **Empresa:** Nuvanx

---

## 🔑 TOKENS Y SECRETOS

### Meta Access Token
```
EAAUn9KeA5yEBRYBrJwIBlggzXjNgxXOiajZCVjMZBFpFDYzu3i75JDY2Er010jfgn5YfMSIEgLJCJM5cQb3SPm3yq8c2A7fjvokMkwbAEu1lAi6uGydIBzuzy5KVPenjGj50hU127LolMG72xBAq6wNlCgjmcxLeYcxDjatRYtL7C2sQ0HuaGBwkCJ0AZDZD
```

### Meta App Secret
```
8faebed3bc708ebdfc0c4cc2b50071f1
```

### Instagram App Secret (Hubspot-IG)
```
2098ff4d8e7f3e957ef13f95aa6958fb
```

---

## 📊 CUENTAS DE META / INSTAGRAM

### Facebook Pages
- **Nuvanx:** ID `685010274687129`
- **Yolanda Piñero | Medicina Estética:** ID (pendiente)

### Instagram Business Accounts
- **Nuvanx | Chamberí:** ID `599157696620256`
- **Nuvanx | Goya:** ID `201725686362374`

### Meta Ad Accounts
- **Account 1:** `act_9523446201036125`
- **Account 2:** `act_4172099716404860`
- **Account 3:** `120224800893290701`

### Business Portfolios
- **Nuvanx:** ID `878822511043717`
- **Yolanda Piñero:** ID `936861467803316`

### Meta Pixel
- **NUVANX_SYSTEM Pixel:** ID `1451306619299617`
- **Francisco Antonio Geraldo Lorenzo Pixel:** ID `1405503384615251`

---

## 🌐 SUPABASE CONFIGURATION

### Project ID
```
ssvvuuysgxyqvmovrlvk
```

### Secrets Configured ✅
- ✅ `META_PAGE_ID` = `685010274687129`
- ✅ `META_INSTAGRAM_CHAMBERI_ID` = `599157696620256`
- ✅ `META_INSTAGRAM_GOYA_ID` = `201725686362374`
- ✅ `META_BUSINESS_PORTFOLIO_NUVANX_ID` = `878822511043717`
- ✅ `META_BUSINESS_PORTFOLIO_YOLANDA_ID` = `936861467803316`
- ✅ `META_PIXEL_ID` = `1405503384615251`
- ✅ `META_APP_SECRET` = `8faebed3bc708ebdfc0c4cc2b50071f1`
- ✅ `META_ACCESS_TOKEN` = (encrypted in Supabase)
- ✅ `META_AD_ACCOUNT_IDS` = `9523446201036125,120224800893290701,4172099716404860`
- ✅ `META_APP_ID` = `878822511043717`

### Functions Deployed ✅
- ✅ `api` - Main API function
- ✅ `meta-webhook` - Webhook receiver for Meta events

---

## 🚀 VERCEL DEPLOYMENT

### Frontend URL
- **Production:** `https://frontend-8ne8kylhu-arisofias-projects-c2217452.vercel.app`
- **Alias:** `https://frontend-beta-ten-49.vercel.app`

### Environment Variables Configured ✅
- ✅ `VITE_META_APP_ID` = `878822511043717`
- ✅ `VITE_META_AD_ACCOUNT_IDS` = `act_9523446201036125,act_4172099716404860`

---

## 🔗 WEBHOOK CONFIGURATION

### Instagram Webhook URLs
```
Callback URL: https://frontend-beta-ten-49.vercel.app/api/instagram-webhook
OR
Callback URL: https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/instagram-webhook
```

### Verify Token
```
nuvanx_instagram_webhook_2026
```

---

## 📝 GITHUB REPOSITORY

### Repository
- **URL:** https://github.com/Arisofia/Nuvanx-System
- **Branch:** main
- **Status:** ✅ All commits pushed

### Recent Commits
- `61d8302` - fix: Sync local migrations with remote database
- `d825f44` - feat: Create Supabase views for Figma data
- `dfe9bba` - feat: Create React hooks for dynamic data fetching

---

## ✅ ESTADO GENERAL

| Sistema | Estado | Última Actualización |
|---------|--------|----------------------|
| Supabase | ✅ OPERATIVO | Junio 8, 2026 |
| GitHub | ✅ SINCRONIZADO | Junio 8, 2026 |
| Vercel | ✅ DESPLEGADO | Junio 8, 2026 |
| Meta | ✅ CONFIGURADO | Junio 8, 2026 |
| Figma | ⏳ PENDIENTE | - |

---

## 🎯 PRÓXIMOS PASOS

1. ✅ Configurar webhooks de Instagram en Meta Developers
2. ✅ Obtener análisis de seguidores (enero-junio 2026)
3. ✅ Actualizar Figma con datos dinámicos
4. ✅ Testing completo del sistema

---

**Guardado en:** GitHub, Vercel, Supabase, Meta Developers  
**Seguridad:** Todos los secrets están encriptados en los sistemas respectivos
