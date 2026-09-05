import { enforceCanonicalMetaRuntimeBoundary } from '../_shared/canonical-meta-runtime.ts';

enforceCanonicalMetaRuntimeBoundary();
await import('./runtime.ts');
