// Public API for the UI primitive components
// Only stable, reusable design system primitives should be exported from here.

export * from './button';
export * from './input';
export * from './textarea';
export * from './badge';
export * from './card';
export * from './tabs';

// Feedback
export * from './toaster';

// Note: Composite/domain-specific components were moved out of ui/ (review June 2026):
// - SortableTable → components/tables
// - FilterBar     → components/filters
// - DataModeBadge → components/dashboard
//
// Deprecated stubs in this folder (that threw on import) were removed after confirming zero remaining references.
