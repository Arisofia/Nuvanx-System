# Design System Rules

**Repository:** Arisofia/Nuvanx-System
**Last Updated:** 2026-04-13
**Source:** Verified from `frontend/tailwind.config.js`, `frontend/src/components/`, `frontend/src/pages/`

> This document captures the current design system as it **actually exists in code**, not as aspirational targets. Future phases should sync these tokens from Figma Variables.

---

## 1. Tailwind Design Tokens

### Color System

Defined in `frontend/tailwind.config.js` — `theme.extend.colors`:

#### Brand (Sky Blue)
```js
brand: {
  50:  '#f0f9ff',  // Faint blue background
  100: '#e0f2fe',  // Light hover
  200: '#bae6fd',
  300: '#7dd3fc',
  400: '#38bdf8',  // Active icon tint
  500: '#0ea5e9',  // Primary CTA, active nav, logo bg, focus rings
  600: '#0284c7',  // CTA hover
  700: '#0369a1',
  800: '#075985',
  900: '#0c4a6e',
}
```

#### Dark (Application Background)
```js
dark: {
  900: '#0a0e1a',  // Page background (deepest)
  800: '#111827',  // Sidebar, card base
  700: '#1f2937',  // Elevated surface (tooltip, modal, hover bg)
  600: '#374151',  // Borders, separators
  500: '#4b5563',  // Disabled or muted UI elements
}
```

#### Semantic Colors (Tailwind defaults, no custom extension)
- `emerald-*` — Success state, positive trends, connected status
- `red-*` / `rose-*` — Error state, negative trends
- `amber-*` / `yellow-*` — Warning state, neutral trends
- `violet-*` — AI/intelligence visual identity
- `gray-*` — Body text, secondary labels

### Spacing & Layout

The application uses **Tailwind's default spacing scale** (no custom spacing tokens). Common patterns:

| Usage | Token | Value |
|-------|-------|-------|
| Page padding | `px-6 py-6` | 24px / 24px |
| Card padding | `p-6` | 24px |
| Section gap | `gap-6` | 24px |
| Sidebar width | `w-60` | 240px |
| Sidebar item padding | `px-3 py-2.5` | 12px / 10px |
| Component border radius | `rounded-xl` | 12px |
| Button border radius | `rounded-lg` | 8px |

### Typography

No custom typography tokens. The application relies on **Tailwind's default font stack** (system sans-serif):

| Role | Classes | Size |
|------|---------|------|
| Page title | `text-xl font-semibold text-white` | 20px bold |
| Section label | `text-xs font-medium text-gray-600 uppercase tracking-wider` | 12px |
| Body text | `text-sm text-gray-400` | 14px |
| Metric value | `text-3xl font-bold text-white tracking-tight` | 30px |
| Caption / hint | `text-xs text-gray-500` | 12px |
| Button text | `text-sm font-medium` | 14px |

---

## 2. Page Layout Conventions

### App Shell (`Layout.jsx`)
```
┌─────────────────────────────────────────────────────────┐
│  Sidebar (w-60, sticky top-0, h-screen)                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Logo area                                         │  │
│  │  Navigation links                                  │  │
│  │  User section (bottom)                             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  Main content (flex-1, overflow-y-auto)                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  TopNav (sticky)                                   │  │
│  │  ─────────────────────────────────────────────     │  │
│  │  <Outlet /> — page content                         │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Page Content Area (standard pattern)
```
<div class="p-6 space-y-6">
  <!-- Page header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold text-white">Page Title</h1>
      <p class="text-sm text-gray-400 mt-0.5">Subtitle</p>
    </div>
    <!-- Optional action button -->
  </div>

  <!-- Grid of MetricCards -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <MetricCard ... />
  </div>

  <!-- Content sections -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Charts, tables, lists -->
  </div>
</div>
```

---

## 3. Component Conventions

### MetricCard (`frontend/src/components/MetricCard.jsx`)
**Usage:** Primary KPI display on Dashboard and LiveDashboard.

```jsx
<MetricCard
  title="Total Revenue"
  value={42300}
  prefix="$"
  change={12.4}
  changeLabel="vs last month"
  icon={DollarSign}
  color="brand"   // brand | emerald | violet | amber
/>
```

**Visual anatomy:**
- `rounded-xl border bg-gradient-to-br` with color-specific gradient
- Icon in top-right with colored circle background
- Value in `text-3xl font-bold`
- Trend badge: emerald for positive, red for negative, gray for neutral

### FunnelChart (`frontend/src/components/FunnelChart.jsx`)
**Usage:** Conversion funnel visualization on Dashboard.

```jsx
<FunnelChart stages={[
  { label: 'Lead', value: 120 },
  { label: 'WhatsApp', value: 95 },
  { label: 'Appointment', value: 67 },
  { label: 'Treatment', value: 41 },
  { label: 'Closed', value: 28 },
]} />
```

Custom SVG-based funnel bar chart (no Recharts dependency).

### IntegrationCard (`frontend/src/components/IntegrationCard.jsx`)
**Usage:** Each integration service card on the Integrations page.

Status badges: `connected` (emerald), `disconnected` (gray), `error` (red pulse), `testing` (amber pulse).

ConnectModal pops a credential input form; service-specific field labels and hints are hardcoded in the component.

### Sidebar (`frontend/src/components/Sidebar.jsx`)
**Navigation items** (in order):
1. Dashboard → `/dashboard`
2. Live Metrics → `/live`
3. CRM → `/crm`
4. Playbooks → `/operativo`
5. Integrations → `/integrations`
6. AI Layer → `/ai`

Active state: `bg-brand-500/15 text-brand-400 border border-brand-500/20` with `ChevronRight` indicator.

### TopNav (`frontend/src/components/TopNav.jsx`)
- Search input with `aria-label="Search"` (accessibility present)
- Notifications bell icon
- Page title display
- User initials avatar with dropdown

---

## 4. Icon System

**Library:** `lucide-react` (consistent across all components and pages).

Common icons by context:

| Context | Icon |
|---------|------|
| Dashboard | `LayoutDashboard` |
| Live metrics | `Activity` |
| CRM | `Users` |
| Playbooks | `BookOpen` |
| Integrations | `Plug` |
| AI Layer | `Bot` |
| Revenue | `DollarSign` |
| Growth trend | `TrendingUp` / `TrendingDown` |
| Refresh / reload | `RefreshCw` |
| Loading | `Loader2` (animated `animate-spin`) |
| Logo accent | `Zap` |
| AI/Suggestions | `Sparkles` |
| Copy to clipboard | `Copy` / `CheckCheck` |
| Success | `CheckCircle` |
| Error | `AlertCircle` |
| Connection | `Link` / `Unlink` |

---

## 5. Dark Theme Convention

The application is **dark-only**. No light mode toggle exists.

Background hierarchy:
```
dark-900 (#0a0e1a)   ← Full page background
  dark-800 (#111827) ← Sidebar, main content cards
    dark-700 (#1f2937) ← Elevated elements (hover, modal, tooltip)
      dark-600 (#374151) ← Borders, dividers
```

Text hierarchy:
```
white          ← Primary headings, values, labels
gray-400       ← Body text, secondary content
gray-500       ← Hints, captions, placeholders
gray-600       ← Muted labels (section headers)
```

---

## 6. Animation / Interaction Patterns

| Pattern | Classes | Usage |
|---------|---------|-------|
| Smooth hover transitions | `transition-all duration-150` | Nav links, buttons |
| Loading spinner | `animate-spin` + `border-t-transparent` | API call loading state |
| Status pulse | `animate-pulse` | Integration error/testing status dot |
| Gradient backgrounds | `bg-gradient-to-br` | MetricCard, hero sections |

---

## 7. Candidate Components for Figma Code Connect

When real Figma node IDs are available, these components are the highest-priority candidates for `figma.connect()` annotations:

| Priority | Component | Rationale |
|----------|-----------|-----------|
| P0 | `MetricCard` | Used ~8× per page; high drift risk |
| P0 | `Sidebar` | Primary navigation; change = critical UX impact |
| P0 | `TopNav` | Present on every authenticated page |
| P1 | `IntegrationCard` | Multiple variants (connected/disconnected/error) |
| P1 | `FunnelChart` | Custom visualization; no external library |
| P2 | `Layout` | App shell — low change frequency |
| P2 | Dashboard page | Complex composition; many metrics |
| P2 | CRM page | Table view with status badges |
| P3 | Integrations page | Card grid layout |
| P3 | AI Layer page | Content generation form |

---

## 8. Known Design System Gaps

1. **No font import** — relies on system fonts. Future: add Inter or similar via Tailwind.
2. **No custom spacing tokens** — uses Tailwind defaults. Documenting vs. Figma will require manual mapping.
3. **No `dark:` variant classes** — hardcoded dark. Adding light mode would require significant refactor.
4. **No CSS custom properties** — all tokens exist only as Tailwind class names. Token sync from Figma would require a build step (e.g., Style Dictionary).
5. **No Figma Variables sync** — `tailwind.config.js` colors are manually maintained. If Figma colors change, a developer must manually update the config.

---

## 9. Route/Page Organization

```
/login           → Login.jsx         (unauthenticated only)
/dashboard       → Dashboard.jsx     (main overview)
/live            → LiveDashboard.jsx (real-time metrics)
/crm             → CRM.jsx           (lead pipeline)
/operativo       → Playbooks.jsx     (automation workflows)
/playbooks       → redirect → /operativo
/integrations    → Integrations.jsx  (service connections)
/ai              → AILayer.jsx       (AI content tools)
```

**Naming convention:** Route URLs are lowercase, single-word or hyphenated. Page component files use PascalCase matching their primary purpose. The `/operativo` exception is intentional (product domain term).
