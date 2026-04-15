# Design System Rules (Extracted from Code)

Date: 2026-04-14

## Token Sources
- Tailwind extension tokens: frontend/tailwind.config.js
- CSS custom properties: frontend/src/index.css

## Colors
- **Brand palette**: Sky/Light Blue variants (e.g., brand.500: #0ea5e9)
- **Dark palette**: Deep slate variants (e.g., dark.900: #0a0e1a)
- **Semantic CSS vars**: --color-success, --color-error, --color-warning in frontend/src/index.css

## Spacing and Radius
- Primary spacing uses Tailwind utility scale throughout pages/components.
- Common surface shape: rounded-xl via .card in frontend/src/index.css.

## Typography
- Base font stack defined in frontend/src/index.css body rule.
- Heading patterns:
  - page title: text-2xl font-bold
  - section title: font-semibold text-white
- Meta/help text pattern: text-xs text-gray-500

## Layout Patterns
- App shell: frontend/src/components/Layout.jsx (Sidebar + TopNav + scrollable main).
- Main content containers commonly use max-w-7xl or max-w-5xl centered layouts.
- Grid pattern for KPI blocks: grid-cols-1/2/4 with gap-4.

## Icon System
- Icon library: lucide-react.
- Icon usage conventions:
  - section glyph in rounded badge (p-2 or p-3)
  - status icons for success/error/loading

## Component Conventions
- Shared primitives in frontend/src/index.css:
  - .card
  - .btn-primary
  - .btn-secondary
  - .btn-ghost
  - .input
- Status chips and dots standardized by badge classes.

## Page Conventions
- Route-to-title consistency handled in frontend/src/components/TopNav.jsx.
- Navigation source of truth in frontend/src/components/Sidebar.jsx.
- Data-truth pattern introduced:
  - API-backed sections explicitly described as API-backed.
  - Placeholder sections explicitly labeled Demo/Mock/Placeholder.

## Candidates for Future Figma Code Connect
- Pages:
  - frontend/src/pages/Dashboard.jsx
  - frontend/src/pages/Playbooks.jsx
  - frontend/src/pages/CRM.jsx
  - frontend/src/pages/LiveDashboard.jsx
  - frontend/src/pages/Integrations.jsx
  - frontend/src/pages/AILayer.jsx
- Shared components:
  - frontend/src/components/MetricCard.jsx
  - frontend/src/components/FunnelChart.jsx
  - frontend/src/components/IntegrationCard.jsx
  - frontend/src/components/Sidebar.jsx
  - frontend/src/components/TopNav.jsx
