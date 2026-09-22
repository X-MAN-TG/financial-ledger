# Financial Ledger

A private, offline-first financial ledger PWA for tracking daily currency-exchange trades. Built with React, TypeScript, and Cloudflare Workers + D1 + R2. Autosaves instantly, works fully offline, and syncs safely when back online.

> **Repository**: [https://github.com/X-MAN-TG/financial-ledger](https://github.com/X-MAN-TG/financial-ledger)

---

## Architecture & Layers

| Layer | Tech | Description |
|---|---|---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, TanStack Query/Table, Recharts, Dexie (IndexedDB), Service Worker (vite-plugin-pwa), jsPDF | Responsive, mobile-first PWA with optimistic UI, offline storage, and instant feedback. |
| **Backend** | Cloudflare Workers (TypeScript) | Native fetch router serving secure API endpoints and single-page application assets. |
| **Database** | Cloudflare D1 (SQLite) | Edge SQLite database providing relational storage for users, days, rows, columns, and audit events. |
| **Backup** | Cloudflare R2 + client-side JSON/CSV/PDF export | Secure object storage for automatic database snapshots and client-side document exports. |
| **Shared** | Zod validation + business rules | Canonical schemas and domain rules shared identically between client and server. |

---

## Core Guarantees

- **Absolute per-user data isolation** — enforced server-side on every request; ownership mismatches return `404`, never confirming another user's data.
- **Offline-first architecture** — every edit writes to IndexedDB first; a sync engine flushes an idempotent queue (client-generated UUIDs + server `sync_operations` ledger) with exponential backoff. Survives tab close/reopen.
- **Idempotent sync** — replaying an `operationId` returns `DUPLICATE_IGNORED`; guarantees no duplicate rows and no lost edits.
- **Completion state machine & totals** — defined once in `shared/business.ts` and re-validated by the Worker (an incomplete row can never be marked completed).
- **Client-only PDF rendering** — the Worker never renders PDFs; exports compile in the client using `jspdf` and `jspdf-autotable`.
- **MAX_USERS cap** — a single configurable environment variable enforced identically at self-signup and owner-created accounts.
- **Eight curated themes** (Light, Dark, OLED Dark, Midnight Navy, Indigo Executive, Emerald Ledger, Slate Graphite, Pearl) driven by CSS custom properties and theme tokens.
- **Owner administration console** — separate authentication path and surface: system health, real-time stats, global audit log, and safe column management (archive, never destroy data).

---

## Repository Layout

```
shared/                 Domain rules, types, and Zod schemas (client + worker)
worker/                 Cloudflare Worker: router, routes/, middleware/, lib/
db/migrations/          D1 migrations: 0001_init.sql, 0002_seed_columns.sql
src/                    React PWA: features/, components/, offline/, hooks/, lib/
public/                 PWA icons, favicon, web manifest
wrangler.toml.example   Cloudflare Worker + D1 + R2 + assets template
.dev.vars.example       Local development secrets template
```

---

## Local Development

```bash
# 1) Install dependencies
npm install

# 2) Set up local secrets and configuration
cp .dev.vars.example .dev.vars
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your local or test configuration

# 3) Terminal A: Start the local Worker API + D1 at http://127.0.0.1:8787
npm run dev:worker

# 4) Terminal B: Start Vite development server at http://localhost:5173
#    (/api requests proxy directly to the Worker on :8787)
npm run dev
```

Build and validation commands:

```bash
npm run typecheck       # Validate TypeScript types across frontend and worker
npm run build           # tsc + vite build -> dist/ (served by Worker in production)
```

---

## Deployment to Cloudflare

1. **Create the D1 database**:
   ```bash
   npx wrangler d1 create daily_ledger_db
   ```
   Copy the generated `database_id` into your `wrangler.toml` under `[[d1_databases]].database_id`.

2. **Create the R2 backup bucket (optional)**:
   ```bash
   npx wrangler r2 bucket create daily-ledger-backups
   ```

3. **Configure deployment secrets**:
   ```bash
   npx wrangler secret put SESSION_SIGNING_KEY
   npx wrangler secret put OWNER_BOOTSTRAP_SECRET
   # Optional Google OAuth:
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   ```

4. **Apply D1 migrations**:
   ```bash
   npx wrangler d1 migrations apply daily_ledger_db --remote
   ```

5. **Deploy application**:
   ```bash
   npm run deploy
   ```

### Provisioning the Initial Owner Account

After deployment, bootstrap the initial Owner account using the bootstrap endpoint and your `OWNER_BOOTSTRAP_SECRET`:

```bash
curl -X POST https://<your-worker-domain>/api/owner/bootstrap \
  -H "content-type: application/json" \
  -d '{
    "bootstrapSecret": "<OWNER_BOOTSTRAP_SECRET>",
    "email": "owner@example.com",
    "password": "<secure-password>",
    "displayName": "Owner"
  }'
```

Once provisioned, access the administration dashboard at `https://<your-worker-domain>/owner/login`.

---

## Offline Synchronization Details

1. **Local persistence**: Edits write directly to Dexie (IndexedDB) with debouncing on text fields and immediate commit on checkboxes, blur, and navigation.
2. **Operation queue**: Transactions receive deterministic UUIDs and are enqueued as pending sync operations.
3. **Batch processing**: The sync engine dispatches pending operations to `POST /api/sync/batch` on application foreground, network reconnection, and scheduled intervals.
4. **Idempotency**: The Worker evaluates `sync_operations` before applying any state modification, ensuring replays never cause data corruption.
5. **Resilience**: Operates seamlessly in full offline mode and recovers reliably on reconnect across mobile and desktop environments.

---

## Security Principles

- All session cookies are configured with `HttpOnly; Secure; SameSite=Lax`.
- Mutation endpoints enforce CSRF double-submit validation via custom request headers.
- Rate limiting protects authentication and sensitive operations.
- Zero secrets or credentials are hard-coded; all sensitive keys are injected securely at runtime via Cloudflare Secrets.
