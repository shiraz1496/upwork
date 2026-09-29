# Developer Handover — Upwork Tracker → Official MCP Migration

**Audience:** the engineer taking over implementation.
**Status:** foundation committed (schema + migration). Application code for the migration is **not yet written** — this document is the build plan.
**Companion docs (read first):**
- `/Users/macssd/Desktop/UPWORK_MCP_MIGRATION_AUDIT.md` — the full policy + capability audit (why we're doing this).
- `AGENTS.md` (repo root) — **"This is NOT the Next.js you know"** — Next.js 16.2.3 has breaking changes; consult `node_modules/next/dist/docs/` before writing route/handler code.

---

## 0. Status at a glance

| Area | State |
|---|---|
| Branch | `feat/mcp-migration` (off `origin/main` = deployed tip `9fa091e`) |
| Commit done | `d2e3bed` — additive Prisma schema + reversible migration SQL |
| Build | ✅ green (`npm run build`) at `d2e3bed` |
| Prisma client | ✅ regenerated with new models |
| Pushed to GitHub? | ❌ blocked (403 — the local git credential lacks write access to `shiraz1496/upwork`). Push manually once write creds are set. |
| App auth rewrite | ⛔ not started |
| Extension shutdown | ⛔ not started |
| MCP integration layer | ⛔ not started |
| Proposal workflow | ⛔ not started (schema/state-machine defined) |
| Dashboards rewiring | ⛔ not started |
| Tests | ⛔ none (no test runner installed yet) |

> **Important git note:** the local `main` was **71 commits behind** `origin/main`. Always base work on `origin/main`, never local `main`. This branch already does.

---

## 1. Context & goal

The app currently ingests Upwork data via a **Chrome extension that scrapes the logged-in `upwork.com` session** and syncs to a Next.js/Postgres backend. The audit found this violates Upwork policy on several grounds (scraping/browser-extension automation, unattended pollers, cross-account monitoring). We are replacing the acquisition layer with Upwork's **official MCP server** (`https://mcp.upwork.com/mcp`, OAuth 2.1) while **preserving the existing frontend/UX**.

**Owner's business requirements (verbatim intent):** per-developer visibility (each dev uses their OWN Upwork account and authorizes their OWN connection), forward-only proposal tracking (no history import), deterministic job review against configured criteria (no autonomous AI ranking), manual proposal submission on upwork.com (never automated), all surfaced in the **existing admin dashboard**. Fresh revamp — **production data is disposable**.

### Non-negotiable compliance guardrails (from the audit)
1. **No scraping, no browser automation, no private GraphQL** as a fallback. MCP or explicit in-app user action only.
2. **No automated proposal submission / messaging.** Humans act on upwork.com.
3. **Per-user OAuth only.** Each developer authorizes their own connection. **Never share tokens/sessions across developers.** MCP is scoped to the authenticating user's own account — it **cannot** reach a developer's account you merely manage.
4. **Hosted-client + scheduling + AI-scoring + storing MCP output require prior Upwork approval** (per MCP/API Terms). Therefore the live MCP integration ships **behind a disabled feature flag** and scheduling stays **off** until approval is obtained. Do not represent these as approved.
5. **Never log** OAuth tokens, access/refresh secrets, private messages, or full proposal bodies.
6. **Don't claim a feature works unless tested.** Distinguish MCP-verified vs app-recorded vs developer-confirmed data in the UI.

---

## 2. Current repository state & how to work

```bash
cd /Users/macssd/Desktop/upwork-tracker
git checkout feat/mcp-migration      # already here
npm ci                               # deps synced to origin/main lockfile
npx prisma generate                  # regenerate client after any schema edit
npm run build                        # type-checks + builds (this is the CI gate)
npm run lint                         # eslint
```
- **Node/pkg manager:** npm (package-lock.json). Next 16.2.3, React 19.2, Prisma 7.7, Zod 4, Tailwind 4.
- **DB:** Postgres via `@prisma/adapter-pg` (`lib/prisma.ts`). `DATABASE_URL` + `DIRECT_URL` in `.env`.
- **No test runner yet.** Add Vitest (see §Testing).
- **Type-check gate:** raw `tsc --noEmit` reports false positives before a build (Next generates `.next/types` during `next build`). **Use `npm run build` as the source of truth.**

### Applying the migration (developer decision — do NOT run against prod casually)
The migration is written but unapplied. For a fresh DB:
```bash
# Option A (fresh revamp, simplest): push schema to a NEW/empty database
DATABASE_URL=<fresh-db> npx prisma db push
# Option B (tracked migrations): move to prisma migrate + apply
npx prisma migrate deploy
```
Files: `prisma/migrations/20260921204514_mcp_migration/migration.sql` (up) and `rollback.sql` (down). The migration is **purely additive** — safe to apply; nothing is dropped.

---

## 3. Architecture: current vs target

**Current (to be dismantled at the seams, not deleted wholesale):**
```
Chrome extension (scrapes upwork.com) --Bearer token--> /api/sync/* --> Postgres --> dashboards
                                          /api/auth/verify, ExtensionToken auth
```

**Target:**
```
Each developer authorizes their OWN Upwork account via OAuth 2.1
        │  (per-user, consented; tokens encrypted server-side)
        ▼
  lib/upwork/  (MCP client, flag-gated: UPWORK_MCP_ENABLED)
        │  read: find_jobs / get_account / get_messages / list_contracts / get_rate_insights
        ▼
  Backend (Next.js) — RETAINED business logic (bidding criteria, blocked titles,
  analytics, coaching/nudges) + NEW proposal-draft workflow + provenance/retention
        ▼
  Postgres (additive schema)  ──►  existing admin + developer dashboards (preserved)
  Proposal submission stays MANUAL on upwork.com (human-in-the-loop)
```

---

## 4. Data model reference (already committed — build on these exact names)

Prisma client accessors are camelCase (`prisma.upworkConnection`, `prisma.proposalDraft`, etc.).

- **`TeamMember`** (existing, extended): added `passwordHash` (scrypt `salt:hash` hex), `passwordSetAt`, `lastLoginAt`, `sessionVersion` (bump to invalidate all sessions). `role` is `admin | bidder` — **"bidder" == developer** (kept the enum value to avoid breaking the frontend which filters `role === "bidder"`).
- **`UpworkConnection`** (new, 1:1 with member via unique `memberId`): `status` (`disconnected|connected|expired|revoked|error`), `upworkAccountId`, `accountName`, `scopes[]`, `accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`, `oauthState`, `oauthCodeVerifier` (PKCE, cleared after callback), `connectedAt`, `lastSyncedAt`, `lastError`. **Tokens stored AES-256-GCM-encrypted; never logged/sent to client.**
- **`ProposalDraft`** (new): `memberId`, `accountId?`, `upworkJobId`, `jobUrl`, `jobTitle`, `jobDescriptionCache?` (**MCP-derived → retention via `jobDataExpiresAt`**), `jobDataProvenance`, `coverLetter` (**developer-authored**), `bidType` (`hourly|fixed`), `proposedRate?`, `fixedBidAmount?`, `state`, `readyAt?`, `submissionConfirmedAt?`, `submittedCoverLetter?` (snapshot at confirm), `submittedBidAmount?`, `submissionProvenance?`.
- **`ProposalState`** enum: `DRAFT → READY → SUBMISSION_UNVERIFIED → SUBMITTED_CONFIRMED`.
- **`ProposalStatusEvent`** (new, append-only): `draftId`, `actorId`, `fromState?`, `toState`, `note?`, `at`. Every transition writes one row.
- **`ClientResponse`** (new): `memberId`, `draftId?`, `upworkThreadId?`, `upworkMessageId?`, `kind` (`message|interview|offer|contract`), `snippet?` (retention via `expiresAt`), `receivedAt?`, `provenance`, `associationMethod` (`verified_identifier|manual`).
- **`JobReviewLog`** (new): `memberId`, `upworkJobId`, `jobTitle?`, `reviewedAt`, `source=APP_RECORDED`. Powers the "jobs reviewed" metric that replaces browser surveillance.
- **`Provenance`** enum: `MCP_VERIFIED | APP_RECORDED | DEVELOPER_CONFIRMED` — **surface this in the UI; never present app-recorded/self-reported data as if MCP-verified.**

**Legacy models retained but going inert:** `ExtensionToken`, `CoverageItem`, `PageVisit`, `VisitLog`, `RequiredPage` (+ `CoverageEntityType`). They stop receiving data once the extension is shut down (§Phase C). Delete them in a **follow-up** migration after the new flow is verified. `Proposal`, `Alert`, `FreelancerProfile` are kept because the existing admin UI renders them; see §Phase G for how to feed them from the new pipeline.

---

## 5. Environment variables

**Existing (keep):** `DATABASE_URL`, `DIRECT_URL`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `TOKEN_HASH_PEPPER`, `GEMINI_API_KEY`.

**Add (new):**
| Var | Purpose |
|---|---|
| `APP_ENCRYPTION_KEY` | 32-byte base64 key for AES-256-GCM token encryption at rest. Generate: `openssl rand -base64 32`. |
| `ADMIN_SESSION_SECRET` | (existing) sign admin session cookie. |
| `DEV_SESSION_SECRET` | **separate** secret for developer session cookie (do NOT reuse the admin secret — audit finding). |
| `UPWORK_MCP_ENABLED` | `"false"` by default. Master flag for the live MCP integration (off until Upwork approves hosted-client use). |
| `UPWORK_MCP_URL` | `https://mcp.upwork.com/mcp` |
| `UPWORK_OAUTH_CLIENT_ID` / `UPWORK_OAUTH_CLIENT_SECRET` | set once Upwork issues them (or via dynamic client registration — **verify**, see §11). |
| `UPWORK_OAUTH_REDIRECT_URI` | e.g. `https://<app>/api/me/upwork/callback` |
| `APP_BASE_URL` | canonical app origin (for OAuth redirect + CORS allowlist). |
| `UPWORK_SYNC_SCHEDULE_ENABLED` | `"false"`. Keep scheduled collection OFF until Upwork approval. |

Document these in `.env.example` (create it) — **never commit real secrets.**

---

## 6. Conventions this codebase enforces (follow exactly)

**Next 16 route handler with dynamic params** (params is a Promise; use the generated `RouteContext` type):
```ts
import { NextRequest } from "next/server";
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/me/proposals/[id]">) {
  const { id } = await ctx.params;         // await it
  // ...
  return Response.json({ ... });
}
```
Non-dynamic routes: `export async function POST(req: NextRequest) { ... }`.

**Other conventions:**
- Prisma import: `import { prisma } from "@/lib/prisma";`
- Input validation: **Zod** on every body/query (see `app/api/admin/team/[id]/route.ts` for the pattern: `Body.parse(await req.json())`, catch `z.ZodError` → 400).
- Responses are `Response.json(...)`. **Preserve existing response shapes** (see §7) so the frontend keeps working.
- Auth guards throw; routes catch and map to status (see `requireAdmin` / `adminErrorResponse` in `lib/admin-auth.ts`).
- Read the Next docs in `node_modules/next/dist/docs/01-app/` before touching middleware/proxy or route segment config.

---

## 7. Frontend contracts that MUST NOT break (backend adapts to these)

The UI is preserved; your endpoints must keep returning these shapes. Key consumers (from the contract map):

- **Admin dashboard `app/page.tsx`:** `GET /api/accounts` (→ `AccountData[]`), `GET /api/alerts` (→ `AlertData[]`, auto-refresh 30s), `GET /api/admin/team` (→ `{members[]}`), `GET /api/admin/coverage-stats`, `POST /api/admin/notes`, `PATCH /api/admin/accounts/{id}`, `POST /api/admin/logout`.
- **Developer dashboard `app/me/page.tsx`:** `GET /api/me/accounts`, `GET /api/me/coverage?freelancerId=`, `GET /api/me/notes`, `GET /api/me/stats?accountId=`, `PATCH /api/me/notes/{id}`, `POST /api/me/logout`.
- **Login pages:** `app/admin/login/page.tsx` POSTs `{password}`; `app/me/login/page.tsx` POSTs `{token}` → **this changes to `{email,password}`; update both this page and the route together** (§Phase A).
- **Admin sub-views** (`components/admin/*`): bidding-criteria, blocked-titles, team, keywords, duplicate-proposals, team-stats, coverage-* — all documented in the contract map with exact fields.
- **Shared types:** `lib/overview-types.ts` exports `ProposalData`, `AlertData`, `AccountData`, `FreelancerProfileData`. **Keep these shapes.** New data must be mapped INTO them.
- **Reusable UI for new affordances:** `ProposalDrawer` (`app/page.tsx:152-406`) for proposal detail; coverage/status bars and notes panels in `app/me/page.tsx` — reuse their styling for Connect/Reconnect/Disconnect/Refresh/Confirm and connection-error states. **Do not build a second dashboard.**

Full table lives in the contract map produced during the audit; reproduce it into the PR description when you touch these.

---

## 8. Remaining work — phase by phase, file by file

Do phases in order. Each keeps the app building. Each has acceptance criteria (AC).

### Phase A — Application auth: two identities (Task #4)
Replace admin shared-password + extension-token developer login with **email + password + server-side sessions** for both `admin` and `bidder`(developer).

**New file `lib/crypto.ts`:**
- `hashPassword(pw): string` and `verifyPassword(pw, stored): boolean` using `node:crypto` `scryptSync` (`salt:hash` hex). No new dependency.
- `encryptSecret(plain): string` / `decryptSecret(enc): string` using AES-256-GCM with `APP_ENCRYPTION_KEY` (format `ivB64:tagB64:cipherB64`). Used for OAuth tokens.
- `redact(obj)` helper for safe logging (drops token/secret/coverLetter/message fields).

**Rewrite `lib/session.ts` (admin) & `lib/me-session.ts` (developer):**
- Keep exported names the proxy imports: `ADMIN_COOKIE`, `verifySessionCookieValue`, `ME_COOKIE`, `verifyMeCookie` (so `proxy.ts` compiles), but change payloads to **identity-bound**: `{ memberId, role, sessionVersion, iat }`, HMAC-signed with **separate secrets** (`ADMIN_SESSION_SECRET` vs `DEV_SESSION_SECRET`). httpOnly, Secure, SameSite=Lax.
- Verify must re-check `sessionVersion` against `TeamMember.sessionVersion` (invalidate on password change / disconnect / role change).

**Routes:**
- `app/api/admin/login/route.ts`: accept `{email,password}`; look up member with `role=admin`, `status=active`, verify `passwordHash`; set admin cookie bound to that member. (Keep `ADMIN_PASSWORD` only as an optional bootstrap for the first admin, or seed via script — see below.)
- `app/api/me/login/route.ts`: accept `{email,password}` (was `{token}`); verify developer; set dev cookie. **Update `app/me/login/page.tsx`** to POST email+password (minimal UI change — reuse existing form styling).
- `lib/admin-auth.ts` `requireAdmin()`: resolve member from the cookie identity (not "oldest admin"); enforce `role=admin`. Return the member so downstream can scope.
- `lib/me-auth.ts`: resolve developer from the dev cookie; **remove the raw-Bearer-token fallback** (that was the extension path).
- Add `requireDeveloper()` returning the member, and `assertOwns(member, resourceMemberId)` for isolation.
- **Seed script** `scripts/set-password.mjs`: set a member's password by email (admin bootstrap + inviting developers). Admin can also trigger a "set password" flow.

**AC:** admin logs in with email+password; developer logs in with email+password; wrong password → 401; changing `sessionVersion` invalidates existing cookies; `proxy.ts` still guards the same paths; build green.

### Phase B — Security hardening (Task #9)
- **CORS:** in `next.config.ts` replace `Access-Control-Allow-Origin: *` with an allowlist derived from `APP_BASE_URL` (and drop the ngrok dev origins for prod). The API is cookie-authenticated; `*` + credentials is unsafe.
- **Split secrets:** admin vs developer session secrets (Phase A).
- **Token storage:** OAuth tokens only ever persisted via `encryptSecret` (Phase D). Never returned to the client; never logged.
- **Log redaction:** route all server logs through `redact()`. Remove the full-payload `console.log` in `app/api/sync/contracts/route.ts` (it's being disabled anyway).
- **Authorization on every sensitive op:** developer endpoints must filter by `memberId` from the session; admin endpoints must confirm `role=admin`. Add tests for isolation (§Testing).

**AC:** no endpoint returns another developer's data; CORS rejects unknown origins; grep shows no logging of `accessToken|refreshToken|coverLetter|lastMessageText`.

### Phase C — Shut down the extension ingestion (Task #8, backend half)
- Make these routes return **HTTP 410 Gone** with `{error:"deprecated", detail:"extension ingestion removed; see MCP migration"}` and do nothing else:
  `app/api/sync/{account,alert,contracts,freelancer-profile,proposal-detail,proposals}/route.ts`, `app/api/auth/verify/route.ts`, `app/api/coverage/visit/route.ts`, `app/api/bidding-criteria/route.ts` + `app/api/blocked-titles/route.ts` + `app/api/freelancer-profile/route.ts` (the extension-facing writers).
- **Refuse extension-token auth:** in `lib/member-auth.ts` stop resolving `ExtensionToken`; return null. Add `scripts/revoke-extension-tokens.mjs` (sets `revokedAt=now()` on all `ExtensionToken`).
- Keep the `extension/` source in git history; remove it from any build step (`package.json` `ext` script can stay but note deprecation).
- Leave admin token-issuance UI (`components/admin/TeamView.tsx` token buttons) but disable the endpoints (`app/api/admin/team/[id]/tokens`, `/tokens/[tokenId]`) → 410, OR hide those buttons (minimal UI change). Document choice.

**AC:** every `/api/sync/*` and `/api/auth/verify` returns 410; a deprecated extension can no longer write; build green.

### Phase D — MCP integration layer `lib/upwork/` (Tasks #5, gated)
**All live calls behind `UPWORK_MCP_ENABLED`.** When false, services return `{ status: "disabled" }` / empty results with `provenance` markers — never fabricated data.

Files:
- `lib/upwork/flags.ts` — reads `UPWORK_MCP_ENABLED`, `UPWORK_SYNC_SCHEDULE_ENABLED`.
- `lib/upwork/client.ts` — minimal **MCP-over-Streamable-HTTP** client (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`) using `fetch` (no new dep). Injectable transport so tests can mock it. **Do not invent tools** — call only names verified against `tools/list` at runtime; log the discovered list.
- `lib/upwork/oauth.ts` — OAuth 2.1 + PKCE: build authorize URL, handle callback, exchange code, refresh. **VERIFY the real endpoints/scopes/registration against Upwork docs before enabling** (see §11). Until verified, keep behind the flag and mark `UNVERIFIED` in comments.
- `lib/upwork/connection.ts` — per-member connection manager: `getConnection(memberId)`, `startAuth`, `completeAuth`, `refreshIfNeeded`, `disconnect` (revoke where supported), status transitions on `UpworkConnection`. **Tokens encrypted via `lib/crypto`.** Never cross-member.
- `lib/upwork/identity.ts` — resolve/verify the connected `upworkAccountId`; guard that a member only ever touches their own account.
- `lib/upwork/jobs.ts`, `messages.ts`, `contracts.ts`, `account.ts` — thin services wrapping verified tools (`find_jobs`, `get_messages`, `list_contracts`, `get_account`, `get_rate_insights`). Each returns normalized DTOs + `provenance: MCP_VERIFIED` + a `retrievedAt`.
- `lib/upwork/normalize.ts` — map raw MCP fields → our DTOs → into `overview-types.ts` shapes where they feed existing UI.
- `lib/upwork/errors.ts` — typed errors (`ConnectionExpired`, `Revoked`, `RateLimited`, `ToolUnavailable`) → safe HTTP mapping; never leak tokens.
- `lib/upwork/mock.ts` — deterministic fixtures for tests and for local dev with the flag off.

Connection routes (developer-facing, reuse UI styling):
- `POST /api/me/upwork/connect` → `startAuth` (returns authorize URL; store PKCE state on `UpworkConnection`).
- `GET /api/me/upwork/callback` → `completeAuth` (exchange code, encrypt+store tokens, set status=connected).
- `GET /api/me/upwork/status` → `{status, accountName, lastSyncedAt, lastError}`.
- `POST /api/me/upwork/disconnect` → revoke + clear tokens + status=revoked/disconnected.

**AC:** with flag off, connect endpoints return a clear "integration disabled pending Upwork approval" state; unit tests exercise the connection state machine + token encryption with a mocked transport; no real Upwork calls in tests.

### Phase E — Proposal tracking workflow + state machine (Task #6)
Pure logic module `lib/proposals/state.ts`:
- `canTransition(from, to): boolean` enforcing `DRAFT→READY→SUBMISSION_UNVERIFIED→SUBMITTED_CONFIRMED` (allow `READY→DRAFT` edit-back; disallow skips; disallow leaving `SUBMITTED_CONFIRMED`).
- `applyTransition(draft, to, actorId, note?)` returns updates + a `ProposalStatusEvent` row.
- **Confirmation is self-reported** → target `SUBMISSION_UNVERIFIED` with `submissionProvenance = DEVELOPER_CONFIRMED`. Only promote to `SUBMITTED_CONFIRMED` if an MCP tool independently verifies (see §11 — likely NOT available; keep at UNVERIFIED and label clearly).

Routes (developer):
- `POST /api/me/proposals` — create `DRAFT` (body: upworkJobId, jobUrl, jobTitle, coverLetter, bidType, proposedRate|fixedBidAmount; associate `memberId` + `accountId`).
- `GET /api/me/proposals` — list own drafts (scoped by session member).
- `PATCH /api/me/proposals/[id]` — edit fields / `DRAFT↔READY`; ownership-checked.
- `POST /api/me/proposals/[id]/confirm` — record submission: snapshot `submittedCoverLetter`/`submittedBidAmount`, set `submissionConfirmedAt`, transition to `SUBMISSION_UNVERIFIED`, write event. **Never auto-submit; never mark submitted just because a draft was saved.**
- `DELETE /api/me/proposals/[id]` — own drafts only.
- Provide the **job URL** for manual submission (Step 4) — a link, not automation.

**AC:** state machine unit-tested (valid + invalid transitions); confirm endpoint produces `SUBMISSION_UNVERIFIED` + an event + snapshot; ownership enforced; build green.

### Phase F — Deterministic job review + client responses (Task #7)
- **Job review:** `GET /api/me/jobs` → via `lib/upwork/jobs.ts` (flag-gated). Apply **deterministic, user-defined filters only** (existing `BiddingCriterion` + `BlockedTitle` + per-account `AccountKeyword`). Reuse/extract the criteria logic currently in `extension/src/content.js` (`checkCriterion`) into `lib/criteria.ts` as a pure function that returns **matched-criteria reasons** (e.g. `["Laravel","REST API","budget in range"]`). **No suitability scores, no autonomous ranking.** Log a `JobReviewLog` when a developer opens a job.
- Retire the Gemini cover-letter scoring path from the required flow (`app/api/analyze/cover-letter`, `app/api/admin/analysis`): keep the code but gate behind a flag defaulting off, and note "AI scoring may require Upwork approval." Do not auto-decide bids.
- **Client responses:** `lib/upwork/messages.ts` → `ClientResponse` rows. Associate to a `ProposalDraft` **only by verified identifier** (thread/job id). If no verified link, set `associationMethod="manual"` and expose a manual-link action; **never guess by client name/title similarity.**

**AC:** filtering is deterministic and unit-tested against fixtures; matched reasons displayed; unassociated responses are clearly "needs manual association"; no AI ranking in the path.

### Phase G — Dashboard adapters (Task #8, frontend half)
Backend adapts to preserved shapes; minimal UI additions only.
- Feed `GET /api/accounts`, `/api/me/accounts`, `/api/alerts`, `/api/me/stats` from the **new** tables (drafts, client responses, job reviews, MCP account data) mapped into `overview-types.ts` shapes.
- **Unknown ≠ zero:** where a metric has no source post-extension (e.g. "jobs viewed on Upwork"), return an explicit `unavailable` marker and render "—/unavailable", not `0`. Add a small provenance badge (MCP-verified / recorded here / self-reported).
- **Coverage:** no data source post-extension. Either hide the coverage UI sections (minimal change) or show them as "disabled (legacy)". Do NOT claim to track Upwork browsing.
- **New minimal UI:** Connect/Reconnect/Disconnect Upwork (developer dashboard), Refresh activity (user-triggered), Confirm submission (proposal), connection/sync error states. Reuse existing components/styling; no second dashboard.

**AC:** existing dashboard renders without runtime errors against new endpoints; provenance visible; removed-metric shows unavailable not zero; verified in a browser (`npm run dev`) — **this phase is not "done" until browser-verified.**

### Phase H — Retention & deletion
- Per-category retention: MCP-derived caches (`ProposalDraft.jobDescriptionCache`/`jobDataExpiresAt`, `ClientResponse.snippet`/`expiresAt`, MCP `FreelancerProfile`) get TTLs; developer-authored content (cover letters) retained per policy. **Copying MCP output locally does NOT exempt it from retention.**
- `scripts/purge-expired.mjs` — nulls/deletes expired MCP-derived fields; runnable manually now, scheduler-ready later (keep schedule OFF).
- Account/member deletion cascades (already modeled via `onDelete: Cascade`).

**AC:** purge script removes only expired MCP-derived data, leaves developer-authored content; dry-run mode.

### Phase I — Tests (Task #10)
Add Vitest: `npm i -D vitest @vitest/coverage-v8` (allowed under fresh-revamp). Add `"test": "vitest run"`.
Cover (all with **mocked MCP**, no live calls):
- `lib/crypto`: password hash/verify, encrypt/decrypt round-trip, redact.
- Auth: session identity binding, `sessionVersion` invalidation, admin vs dev separation, ownership/isolation guard.
- Connection state machine (connect→expired→refresh→revoke) with mocked transport.
- Proposal state machine: valid + invalid transitions; confirm → `SUBMISSION_UNVERIFIED` + event + snapshot.
- Deterministic criteria filter against fixtures (matched reasons, blocked titles).
- Client-response association: verified-id links; no-id → manual.
- Extension shutdown: `/api/sync/*` and `/api/auth/verify` return 410; extension token auth refused.

**AC:** `npm run test` green; `npm run build` green; `npm run lint` clean. Do not claim untested features.

### Phase J — Verify, document, ship
- Update `.env.example` and the env docs (§5).
- Write `UPWORK_MCP_IMPLEMENTATION_REPORT.md` (deliverable): preserved / migrated / disabled / needs-authorization features; tested vs untested; changed-files list; outstanding MCP limitations.
- Browser-verify Phase G with `npm run dev`.
- Push `feat/mcp-migration` (needs write creds — see §0) → Vercel **preview**. **Do not** promote to production or run destructive prod migrations. Connect a **real** developer account only with explicit authorization and only after Upwork approves hosted-client use.

---

## 9. Proposal state machine (spec)

```
DRAFT ──ready──► READY ──confirm-submission──► SUBMISSION_UNVERIFIED ──[MCP verify?]──► SUBMITTED_CONFIRMED
  ▲                │
  └──── edit ◄─────┘
```
- Only the owning developer transitions their own drafts.
- `confirm` snapshots `submittedCoverLetter` + `submittedBidAmount`, sets `submissionConfirmedAt`, `submissionProvenance = DEVELOPER_CONFIRMED`, → `SUBMISSION_UNVERIFIED`.
- `SUBMITTED_CONFIRMED` is reachable **only** via an official MCP verification of the submission. Per the audit, a freelancer "list my proposals / submit" tool is **NOT confirmed to exist** — so in practice proposals likely remain `SUBMISSION_UNVERIFIED`, and the UI must say so. Do not fake promotion.
- Every transition writes a `ProposalStatusEvent`.

---

## 10. Isolation & authorization rules (enforce everywhere)

1. Developer endpoints resolve `memberId` from the session and filter **all** queries by it. Never accept a `memberId`/`freelancerId` from the client as the source of truth.
2. Admin endpoints require `role=admin`; admins may read authorized team records but must not mutate a developer's OAuth connection.
3. One `UpworkConnection` per member (unique). A member's tokens are used **only** for that member's calls. Add a guard in `lib/upwork/connection.ts` that refuses if `connection.memberId !== session.memberId`.
4. On password change / disconnect / role change → bump `TeamMember.sessionVersion`.

---

## 11. MCP capability reference & verification checklist (from the audit — VERIFY before enabling)

Verified via live connector introspection (`com.upwork.mcp`); Upwork's own pages 403'd direct fetch. Treat as **starting point, re-verify against `tools/list` at runtime**:
- **Auth:** OAuth 2.1, per-user, no API keys; revocable in Upwork Account Settings → Connected Apps.
- **~33 `upwork__` tools**, e.g. `get_account`, `list_accounts`, `find_jobs`, `get_job_posting`, `get_messages`, `send_message`, `list_contracts`, `get_rate_insights`, `manage_client_proposals`, `manage_offers`, draft/confirm helpers.
- **Reads we rely on:** `find_jobs`, `get_account`, `get_messages`, `list_contracts`, `get_rate_insights`.

**Must verify before turning `UPWORK_MCP_ENABLED` on (open questions for Upwork):**
1. ⚠ Is there a **freelancer-side "list my proposals" / submission-verification** tool? Introspection suggested **client-heavy** tooling and **no freelancer submit/accept** tool. If absent, proposals stay `SUBMISSION_UNVERIFIED` (expected).
2. ⚠ Exact **OAuth endpoints, scopes, and whether dynamic client registration** is supported vs. pre-registered client credentials. Do not hardcode guesses.
3. ⚠ **Hosted-client approval:** MCP/API Terms reportedly require contacting Upwork Support before "connecting a hosted client, using more than one tool, scheduled activity, AI-based scoring, or storing MCP output." **Our app does several of these.** Obtain written approval; until then ship behind the flag.
4. ⚠ **Rate limits** for the MCP endpoint (sources conflicted: 10 req/s vs 300 req/min). Implement backoff on 429; cache ≤24h.
5. ⚠ **Retention** obligations for stored MCP output (client PII). Confirm and encode TTLs (Phase H).

Sources: see `UPWORK_MCP_MIGRATION_AUDIT.md` §5–6 and its URL list (`www.upwork.com/ai/mcp`, support article `55446516654611`, developer GraphQL docs).

---

## 12. Risk register
- **Enabling MCP without Upwork approval** → account/API-access risk. Mitigation: flag off by default; get approval.
- **Assuming tools exist** → runtime failures. Mitigation: gate every call on runtime `tools/list`.
- **Token leakage** → account compromise. Mitigation: AES-GCM at rest, redacted logs, never to client.
- **Cross-developer data bleed** → privacy/compliance. Mitigation: session-scoped queries + ownership guards + isolation tests.
- **Presenting self-reported as verified** → misleading metrics. Mitigation: `Provenance` everywhere; unknown≠zero.
- **Frontend regressions** → preserve response shapes; browser-verify Phase G before shipping.

---

## 13. Definition of done
- [ ] Admin + developer email/password auth; identity-bound, split-secret sessions; `sessionVersion` invalidation.
- [ ] All `/api/sync/*` + `/api/auth/verify` return 410; extension token auth refused; tokens revoked.
- [ ] `lib/upwork/` complete, flag-gated, tokens encrypted, per-user isolation guard, mockable.
- [ ] Proposal workflow (DRAFT→READY→SUBMISSION_UNVERIFIED[→SUBMITTED_CONFIRMED only if MCP-verified]) with audit events; no auto-submit.
- [ ] Deterministic job filtering with matched-criteria reasons; no AI ranking in the path.
- [ ] Client responses associated by verified id or manual; never by guessing.
- [ ] Dashboards render on new endpoints; provenance shown; unknown≠zero; coverage disabled cleanly.
- [ ] Retention TTLs + purge script.
- [ ] CORS locked to `APP_BASE_URL`; no secrets/messages/proposals logged.
- [ ] Vitest suite green; `npm run build` + `npm run lint` green.
- [ ] `.env.example` + `UPWORK_MCP_IMPLEMENTATION_REPORT.md` written.
- [ ] Browser-verified; branch pushed → preview; **no prod deploy / no destructive prod migration; no real account connected without authorization + Upwork approval.**

---
*Foundation committed at `d2e3bed` on `feat/mcp-migration`. Everything above is additive and reversible. Build on the exact model/field names in §4.*
