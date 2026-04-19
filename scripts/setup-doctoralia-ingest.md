# Doctoralia Data Ingestion Setup

## Google Sheets Reference
- **Sheet ID**: `1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw`
- **URL**: `https://docs.google.com/spreadsheets/d/1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw/`

## Prerequisites

### 1. Google Service Account Setup
You need a Google service account JSON file with Sheets API access:

**Steps**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Sheets API**
4. Create a **Service Account** (IAM & Admin → Service Accounts)
5. Generate a **JSON key** for the service account
6. Download and save as: `backend/google-service-account.json`
7. Share the Google Sheet with the service account email (from the JSON)

### 2. Environment Variables
Add to `backend/.env`:
```bash
CLINIC_ID=4207023b-eac1-4249-bf0f-d9b1e36a5d7a
DOCTORALIA_SHEET_ID=1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw
GOOGLE_SERVICE_ACCOUNT_FILE=backend/google-service-account.json
```

## Execution

### Option 1: Via CLI Script (Recommended)
```bash
# From project root
node scripts/ingest-doctoralia.js

# Or with explicit env vars
CLINIC_ID=4207023b-eac1-4249-bf0f-d9b1e36a5d7a \
DOCTORALIA_SHEET_ID=1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw \
node scripts/ingest-doctoralia.js
```

### Option 2: Dry Run (Preview without inserting)
```bash
DRY_RUN=1 node scripts/ingest-doctoralia.js
```

## Expected Data Flow

**Google Sheet columns** (as per Doctoralia export):
```
Estado | Fecha | Hora | Fecha creación | Hora creación | 
Asunto | Agenda | Sala/Box | Confirmada | Procedencia | Importe | Acciones
```

**Ingestion Pipeline**:
1. Read rows from Google Sheet
2. Normalize phone numbers (extract digits)
3. Hash DNI for deduplication
4. Upsert patients (by clinic_id + dni_hash)
5. Upsert financial_settlements (by operation_id)
6. Reconcile leads → patients (via DNI hash)

**Result**:
- `patients` table: Updated with Doctoralia patient records
- `financial_settlements` table: Updated with verified revenue
- `leads.converted_patient_id`: Auto-linked via DNI hash matching
- Frontend Dashboard: Live KPI charts showing Doctoralia data

## Database Tables Updated

### `patients`
| Column | Source | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `clinic_id` | CLINIC_ID env var | Clinic scope |
| `dni` | Doctoralia export | Golden Key for deduplication |
| `name` | Asunto column | Patient name |
| `email` | Procedencia column (if email) | Contact |
| `phone` | Procedencia column | Contact |
| `total_ltv` | Doctoralia Importe sum | Lifetime value |

### `financial_settlements`
| Column | Source | Purpose |
|---|---|---|
| `id` | Acciones (operation ID) | Primary key (external) |
| `clinic_id` | CLINIC_ID | Clinic scope |
| `patient_id` | Join via DNI | Patient reference |
| `amount_net` | Importe (net) | Verified revenue |
| `amount_gross` | Calculated | Gross before discount |
| `amount_discount` | Calculated | Discount applied |
| `template_name` | Asunto | Treatment type |
| `settled_at` | Fecha | Settlement date |

## Troubleshooting

**Error: "google-service-account.json not found"**
- Download from Google Cloud Console (IAM & Admin → Service Accounts → Keys)
- Save to `backend/google-service-account.json`

**Error: "Permission denied on spreadsheet"**
- Share the Google Sheet with the service account email
- Email format: `<name>@<project>.iam.gserviceaccount.com`

**Error: "CLINIC_ID not found"**
- Ensure `clinic_id` is set on the user's row in `users` table
- Default clinic ID: `4207023b-eac1-4249-bf0f-d9b1e36a5d7a`

**Data not appearing in Dashboard**
- Verify `/api/kpis` endpoint returns `{ doctoralia: { totalNet, ... } }`
- Check `financial_settlements` table has rows
- Ensure `CLINIC_ID` environment variable matches user's `clinic_id`

## Real-Time Workflow

After ingestion is set up:

1. **Export Doctoralia** → Google Sheet
2. **Run ingestion script** → `node scripts/ingest-doctoralia.js`
3. **Verify in Dashboard** → `/api/kpis` shows live Doctoralia KPIs
4. **Track source-to-cash** → Dashboard shows lead → patient → settlement mapping
5. **Generate reports** → VerifiedFinancials page shows settlement breakdown

## Next Steps

Once ingestion is complete:
- [ ] Backend API deployment target configured and reachable
- [ ] Push to main triggers auto-deploy
- [ ] Frontend accesses `/api/financials/*` and `/api/kpis`
- [ ] Live Doctoralia revenue appears in Dashboard & VerifiedFinancials

---

**Questions?**
- Check `scripts/ingest-doctoralia.js` for full source code
- See `supabase/migrations/20260418160000_revenue_os_foundation.sql` for schema
- See `backend/src/routes/financials.js` and `backend/src/routes/kpis.js` for API responses
