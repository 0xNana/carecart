# CareCart web application

This Next.js application contains the public product pages, the authenticated clinic workspace, and the local operations demo. The root [README](../README.md) is the source of truth for product scope, setup, security boundaries, and payment evidence.

## Local setup

From the repository root, install the web dependencies and configure the root environment file as described in the root README:

```bash
npm ci --prefix web
cp .env.example .env
ln -s ../.env web/.env.local
```

The `/operations` route supports the isolated synthetic walkthrough without hosted identity credentials. The `/app` clinic workspace uses Supabase authentication and requires the corresponding local environment settings.

## Checks

```bash
npm test --prefix web
npm run lint --prefix web
npm run build --prefix web -- --webpack
```

Do not put payment signing keys in the shared environment file. See the root README for the supported process-specific configuration and the current clinic approval boundary.
