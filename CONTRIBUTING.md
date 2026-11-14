# Contributing to CareCart

Thank you for contributing to CareCart. Contributions can include bug fixes, usability improvements, documentation, tests and integrations.

## Before you start

Check [existing issues](https://github.com/0xNana/carecart/issues) and the [product roadmap](https://docs.carecart.xyz/product-roadmap) for related work. For a substantial change, open an issue describing the problem and proposed approach before beginning implementation.

For bug reports, include reproduction steps, expected and actual behavior, and relevant version information. Remove credentials, personal information and clinic records from logs and screenshots.

## Development setup

### Install dependencies

Use Node.js **24.21.0** and npm **12.2.1**. The Rust toolchain is pinned to **1.93.0** with the `wasm32-unknown-unknown` target.

From the repository root:

```bash
nvm use
npm ci --prefix backend
npm ci --prefix web
```

Start the frontend development server:

```bash
npm run dev --prefix web
```

The website and product documentation are available at [localhost:3000](http://localhost:3000). The complete clinic workflow can be exercised with the [local demonstration](README.md#local-demonstration), which starts its own services and uses sample data.

### Authentication and configuration

The signed-in workspace uses Supabase authentication. The repository provides [.env.example](.env.example), [.env.identity.example](.env.identity.example) and [.env.testnet.example](.env.testnet.example) as configuration references.

For local integration work, create an untracked environment file:

```bash
cp .env.example .env
ln -s ../.env web/.env.local
```

Use a development Supabase project and configure its callback URLs for the local application origin. The tenant API starts from `backend/src/tenancy/server.ts`, and the inventory worker starts from `backend/src/tenancy/worker.ts`. Both require the configuration described in the environment examples. Start the tenant API in a separate terminal with `npm run dev --prefix backend`. The explicit `dev:prototype` command runs the older read-only prototype; it does not serve the signed-in workspace.

Runtime profiles contain database paths that must match the checkout. Use development profiles and local data for integration work. The automated tests and browser walkthrough create isolated fixtures without hosted credentials.

Keep signing keys separate from the web, API and inventory-worker environment. Never commit `.env` files, private keys, real clinic databases or customer records.

## Product documentation

Public product guides live in the repository-root `docs/` directory as MDX, with navigation in `docs/meta.json`. The same Next.js application serves them at `docs.carecart.xyz`; local development keeps `/docs` URLs. Internal release notes belong in ignored `internal-docs/`.

Use `/docs/page-name` for links between MDX guides. The documentation renderer maps them to clean paths on the docs subdomain and retains the prefix locally. Add a title and description to every page, then run the content, routing and type checks.

For Vercel projects whose Root Directory is `web`, allow source files outside that directory in the build settings so the root MDX collection is included. The Next.js bundler and tracing roots cover the repository; isolated verification snapshots copy the public docs as well. Attach `docs.carecart.xyz` to the same Vercel project without a domain redirect, using Vercel’s specified DNS target.

## Making changes

1. Fork the repository and create a descriptive branch.
2. Keep the change focused on one problem.
3. Follow the conventions of the surrounding code and the pinned framework versions.
4. Add or update tests for changed behavior. Documentation and styling changes should receive the relevant content or visual checks.
5. Update documentation when setup, configuration or user-facing behavior changes.

Use clear names and plain product language. Show loading, empty, error and success states where applicable. Interface changes should support keyboard navigation, visible focus, readable contrast and small screens.

Inventory quantities, purchase limits and payment status must continue to reflect stored records and verified evidence. A submitted transaction must never be presented as a confirmed payment. Keep delivery recording separate from payment processing.

## Validation

### Complete backend and frontend checks

From the repository root:

```bash
bash scripts/verify-phase2.sh
```

This runs tests, TypeScript checks, lint and a production web build. Backend tests and the web build use a temporary copy that excludes local credentials and operational data.

### Individual checks

| Command | Purpose |
| --- | --- |
| `npm test --prefix backend -- --maxWorkers=1` | Run backend tests with a single worker. |
| `npm run typecheck --prefix backend` | Check backend TypeScript. |
| `npm test --prefix web` | Run frontend tests. |
| `npm run lint --prefix web` | Run frontend lint. |
| `npm run build --prefix web` | Build the Next.js application. |
| `bash scripts/verify-phase2.sh --web-only` | Run frontend tests, route/type checks, lint and an isolated production build. |

Use the single-worker backend command on machines where concurrent tests exceed their time limits. Keep test assertions and timeouts intact.

### Browser checks

After creating a build with the verification script, use its printed directory in the walkthrough command:

```bash
node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.SNAPSHOT
```

Replace `SNAPSHOT` with the printed suffix. Add `--headed` for a visible Chromium session. Set `CARECART_CHROMIUM_BIN` if the executable is not at `/snap/bin/chromium`.

For interface changes, review desktop, tablet and mobile layouts. Check navigation, form validation, dialog focus, table scrolling, long references and duplicate submissions. Use sample data in screenshots.

### Contract checks

```bash
cargo test --manifest-path contracts/Cargo.toml --locked --workspace
cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked
```

Contract tests use local accounts and token fixtures. See the [safety-vault README](contracts/carecart-safety-vault/README.md) for build commands and contract-specific requirements.

## Pull requests

A useful pull request explains:

- The problem and resulting behavior.
- The scope of the change and any relevant issue.
- How it was tested.
- Screenshots for visible interface changes.
- Configuration, compatibility or migration requirements, if any.

Include lockfile changes when updating dependencies. Avoid unrelated formatting or generated files. Do not include credentials, local databases, production records or private operational notes.

## License and attribution

Contributions are provided under the project’s [MIT License](LICENSE). Preserve existing copyright and license notices, and include appropriate attribution and license information for any third-party code or assets.
