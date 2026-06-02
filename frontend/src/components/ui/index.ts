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

// Note: Composite/domain-specific components (FilterBar, SortableTable, DataModeBadge)
// exist as copies in ui/ (actively imported by pages) and in domain folders
// (dashboard/, filters/, tables/). The domain-folder copies were unreferenced
// (confirmed via full codebase search) and have been removed to eliminate
// duplication and future drift risk. ui/ versions remain the source for now.
