# Cloudflare frontend runtime

Cloudflare Workers Static Assets is the sole canonical runtime and owner of the NUVANX frontend. The frontend is built from `frontend/` and deployed only through the repository's governed Cloudflare workflows.

## Runtime contract

Production browser traffic uses the Cloudflare Worker target configured by the repository. Supabase remains the backend and data owner; this runtime contract does not alter Supabase services, migrations, or data.

## Deployment contract

The canonical deployment path is GitHub CI followed by the existing Cloudflare deployment workflow. The workflow validates the approved commit, builds the frontend, deploys the `nuvanx-frontend` Worker, records deployment provenance, and runs the existing runtime acceptance checks.

Do not add a second frontend deployment provider, bypass branch protection, or introduce provider-specific configuration into `frontend/`.
