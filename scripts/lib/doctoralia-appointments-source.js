'use strict';

const CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET = 'Base Completa Doctoralia';

function getDoctoraliaAppointmentsSourceDecision(env = process.env) {
  const requested = String(env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || '').trim();
  const requestedNonCanonical = Boolean(
    requested && requested !== CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET,
  );

  return {
    canonical: CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET,
    requested: requested || null,
    overrideAllowed: false,
    nonCanonicalIgnored: requestedNonCanonical,
    resolved: CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET,
  };
}

function resolveDoctoraliaAppointmentsSheetName(env = process.env) {
  return getDoctoraliaAppointmentsSourceDecision(env).resolved;
}

module.exports = {
  CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET,
  getDoctoraliaAppointmentsSourceDecision,
  resolveDoctoraliaAppointmentsSheetName,
};
