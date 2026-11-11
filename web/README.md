# CareCart Web Application (`/app`)

CareCart provides a unified operational workspace at `/app` with Overview, Inventory, Replenishment, Suppliers, Payments, Activity, and Settings views, paired with a persistent **NEAR Testnet** indicator and **Live NEAR AI Cloud (`z-ai/glm-5.3-flash`)** procurement specialist controls.

## Key Capabilities

- **Authentication & Clinic Isolation:** Supabase SSR validates user identity, active clinic membership, and server-enforced roles (`Admin`, `InventoryManager`, `ProcurementReviewer`, `Viewer`). Configure the root [`.env`](file:///home/nana/projects/carecart/.env.example) and symlink `web/.env.local -> ../.env`.
- **Append-Only Inventory Ledger:** Staff receive stock, dispense, record direct consumption, and append reasoned adjustments. A headless background monitor evaluates stock coverage and triggers replenishment cases automatically.
- **Live NEAR AI Cloud Specialist:** Operators can evaluate any replenishment case with **NEAR AI Cloud (`z-ai/glm-5.3-flash`)** or run the deterministic check directly from the case drawer in `/app`.
- **Policy-Guarded Testnet Payments:** Canonical purchase orders, NEP-413 wallet ownership verification, and scoped `committer` / `requester` authorizations target `safety-v2.carecart.testnet` (`CCUSD`). Web and API processes never hold signing keys.

## Verification

From the repository root, using Node `24.21.0`:

```bash
nvm use
cd web && npx tsc --noEmit && npm test
```
