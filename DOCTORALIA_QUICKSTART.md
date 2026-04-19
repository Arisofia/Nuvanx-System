# Doctoralia Data Ingestion — Quick Start

Your Google Sheet: **Sheet ID `1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw`**

---

## Three Steps to Activate

### Step 1: Get Google Service Account Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable **Google Sheets API**
4. Go to **IAM & Admin → Service Accounts**
5. Click **Create Service Account**
6. Create a **JSON key** and download it
7. Save to: `backend/google-service-account.json`

### Step 2: Share the Sheet
1. Get the service account email from the JSON file (format: `name@project.iam.gserviceaccount.com`)
2. Open your Google Sheet
3. Click **Share** → paste the service account email → **Editor** access

### Step 3: Run Validation & Ingest

**Validate setup:**
```bash
node scripts/validate-doctoralia-setup.js
```

**Preview (dry-run):**
```bash
DRY_RUN=1 node scripts/ingest-doctoralia.js
```

**Ingest data:**
```bash
node scripts/ingest-doctoralia.js
```

---

## What Happens Next

After ingestion:

1. **Patients imported**: All Doctoralia patients (name, phone, email, DNI) added to database
2. **Revenue recorded**: All appointments upserted to `financial_settlements` table
3. **Leads reconciled**: Leads auto-matched to patients via DNI hash
4. **KPIs updated**: Frontend Dashboard shows live:
   - Total verified revenue (Doctoralia net)
   - Average ticket size
   - Settlement count
   - Discount rate
   - Monthly revenue chart
   - Treatment type breakdown

5. **Source-to-cash visible**: End-to-end funnel from Meta ad → lead → patient → revenue

---

## Your Google Sheet

**Currently referenced**:
- Sheet ID: `1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw`
- Expected columns (Doctoralia export):
  - Estado, Fecha, Hora, Fecha creación, Hora creación
  - Asunto, Agenda, Sala/Box, Confirmada, Procedencia, Importe, Acciones

---

## Frontend Result

Once backend is deployed to Render (see Phase 6 in previous audit):

**Dashboard** → Shows:
- Doctoralia KPI cards
- Monthly revenue chart
- WhatsApp engagement funnel
- Lead acquisition metrics

**VerifiedFinancials** → Shows:
- Settlement table (doctor, template, amount, date)
- Monthly breakdown
- Treatment type distribution
- Patient LTV ranking

**MetaIntelligence** → Shows (if Meta credentials set):
- Campaign performance
- Ad spend vs. revenue
- Lead attribution

---

## Troubleshooting

**"Permission denied" error**
- Verify you shared the Google Sheet with the service account email
- Sheet ID must match `DOCTORALIA_SHEET_ID` env var

**"CLINIC_ID not found" error**
- Set `CLINIC_ID=4207023b-eac1-4249-bf0f-d9b1e36a5d7a` in `.env`
- Or ensure clinic exists in Supabase `clinics` table

**Data not appearing in Dashboard**
- Run validation: `node scripts/validate-doctoralia-setup.js`
- Check backend is deployed (no 404 errors)
- Verify `/api/kpis` returns `{ doctoralia: { totalNet, ... } }`

---

## Support

- **Setup guide**: `scripts/setup-doctoralia-ingest.md`
- **Validation**: `node scripts/validate-doctoralia-setup.js`
- **Interactive helper**: `node scripts/ingest-doctoralia-helper.js`
- **Ingest script**: `scripts/ingest-doctoralia.js`

---

**Next**: Deploy backend to Render, then run ingestion, then watch live data flow! 🚀
