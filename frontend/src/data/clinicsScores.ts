// Shared clinic scores - SINGLE SOURCE OF TRUTH
// Replaces tripled array in:
// - 21SlideExecutiveScorecard.tsx
// - 34Tabla.tsx
// - 00ConsolidatedDeck.tsx

export const CLINIC_SCORES = [
  { name: 'Clínica Londres', score: 92 },
  { name: 'Diego de León', score: 90 },
  { name: 'IML', score: 86 },
  { name: 'Cliniem', score: 84 },
  { name: 'Esquivel', score: 82 },
  { name: 'MG Clinic', score: 78 },
  { name: 'Templa', score: 76 },
  { name: 'Metódyca', score: 74 },
  { name: 'Kiharu', score: 72 },
  { name: 'Pedro Jaén', score: 70 },
  { name: 'NUVANX Chamberí', score: 52 },
  { name: 'NUVANX Goya', score: 50 },
];

// Additional clinics for ConsolidatedDeck (14 extra)
export const CLINIC_SCORES_EXTENDED = [
  ...CLINIC_SCORES,
  { name: 'Clínica Premium', score: 88 },
  { name: 'Centro Estético', score: 85 },
  { name: 'Medicina Avanzada', score: 83 },
  { name: 'Clínica Moderna', score: 81 },
  { name: 'Centro de Salud', score: 79 },
  { name: 'Estética Plus', score: 77 },
  { name: 'Clínica Integral', score: 75 },
  { name: 'Centro Médico', score: 73 },
  { name: 'Medicina Estética', score: 71 },
  { name: 'Clínica Especializada', score: 69 },
  { name: 'Centro Dermatológico', score: 67 },
  { name: 'Clínica Dental', score: 65 },
  { name: 'Medicina Regenerativa', score: 63 },
  { name: 'Centro de Belleza', score: 61 },
];
