# MCP Migration — Progress Tracker

Plan: [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md) (Phases A → J). This file tracks what is done, what is in progress, and open questions.
Branch: `feat/mcp-migration` (base: `origin/main` @ `9fa091e`, foundation commit `d2e3bed`).

## Now working on
- Phases A, B, C done (not committed yet). **Next: Phase D — MCP layer `lib/upwork/`** (blocked in part by open question 1: how accounts connect).

## Phase checklist

| Phase | What | Status |
|---|---|---|
| — | Local setup (deps, local DB, schema, build, dev server) | ✅ done |
| A | Email + password auth for admin & bidder; identity-bound sessions | ✅ done (uncommitted) |
| B | Security hardening (CORS allowlist, log redaction, isolation) | ✅ done (uncommitted) |
| C | Shut down extension ingestion (`/api/sync/*` → 410) | ✅ done (uncommitted) |
| D | MCP layer `lib/upwork/` (flag-gated, mocked) | ⏳ todo |
| E | Proposal workflow + state machine | ⏳ todo |
| F | Deterministic job review + client responses | ⏳ todo |
| G | Dashboard adapters (preserve UI shapes, provenance, unknown ≠ zero) | ⏳ todo |
| H | Retention & purge script | ⏳ todo |
| I | Vitest test suite | ⏳ todo |
| J | `.env.example`, implementation report, browser verify, push → preview | ⏳ todo |

## Log

### 2026-09-29
- Checked out `feat/mcp-migration` from `origin/feat/mcp-migration`.
- Local setup:
  - Node **22** required (Prisma 7 dependency needs `node >= 22`); used nvm `v22.22.2`.
  - `npm ci` ok.
  - Local Postgres in Docker (`upwork-pg`, port **5433**); schema applied with `prisma db push` (handover §2 Option A). All 20 tables incl. new MCP tables created.
  - `.env.local` now points `DATABASE_URL`/`DIRECT_URL` at the local DB and holds local values for the new env vars (§5). `.env` (hosted DB) left untouched.
  - `lib/prisma.ts`: SSL disabled only for `localhost` so the local DB works.
  - `npm run build` ✅ green. `npm run dev` ✅ serves `/admin/login`, `/me/login`; APIs return 401 unauthenticated.

- **Context from team:** extension/website is NOT live (stopped because of policy). Supabase = prod DB (was paused, now resumed), Neon = staging DB. Dev work uses the local Docker DB only; prod is untouched.

### Phase A — email + password auth ✅
Files:
- `lib/crypto.ts` (new): scrypt `hashPassword`/`verifyPassword`, AES-256-GCM `encryptSecret`/`decryptSecret` (for OAuth tokens later), `redact()` for logs.
- `lib/signed-session.ts` (new): shared HMAC cookie signer; payload `{memberId, role, sessionVersion, iat}`.
- `lib/session.ts` (admin, `ADMIN_SESSION_SECRET`) and `lib/me-session.ts` (bidder, **`DEV_SESSION_SECRET`**): identity-bound cookies, separate secrets. Exported names kept so `proxy.ts` is unchanged.
- `lib/admin-auth.ts`: `requireAdmin()` resolves the admin from the cookie (was "oldest admin"), checks role/status/`sessionVersion`.
- `lib/me-auth.ts`: cookie-only (Bearer-token fallback removed); added `requireDeveloper()` + `assertOwns()`.
- `lib/member-auth.ts`: `SafeMember` type, `ForbiddenError` → 403. Extension-token resolver left alone until Phase C.
- `lib/login.ts` (new): shared email+password check (same error for every failure, constant-ish timing).
- `lib/prisma.ts`: **`passwordHash` omitted globally** — `GET /api/admin/team` and every `include: { member: true }` would otherwise have sent hashes to the browser.
- `app/api/admin/login`, `app/api/me/login`: accept `{email, password}`. Login pages updated (email field added, same styling).
- `app/api/admin/team/[id]`: optional `password` field; role/status/password change bumps `sessionVersion`.
- `scripts/set-password.mjs` (new): set a password / create first admin. Needs explicit `DATABASE_URL`, prompts for password.

Verified (curl vs local dev server): admin + bidder login ok; wrong password / unknown email / wrong role → 401; old `{password}` body → 400; no `passwordHash` in team JSON; bidder cookie rejected by admin API; after password change old cookie → 401 `session_expired`; `/` and `/me` load with cookies. `npm run build` ✅, eslint on changed files ✅.

Follow-ups noted:
- No "set password" button in admin Team UI yet (API supports it). Add in Phase G with the other minimal UI.
- `ADMIN_PASSWORD` env is now unused.
- Before first deploy: run `set-password.mjs --create` against that DB to make the first admin, and set `DEV_SESSION_SECRET` + `APP_ENCRYPTION_KEY` in Vercel.

- Login pages: password show/hide eye toggle (`components/ui/PasswordInput.tsx`), checked in Chrome on `/me/login` and `/admin/login`.

### Phase B — security hardening ✅
- **CORS** (`next.config.ts`): `*` removed → only `APP_BASE_URL` origin (no header at all if unset). ngrok `allowedDevOrigins` removed (were only for the extension).
- **Logging**: new `lib/log.ts` (`logError`/`logInfo`, runs through `redact()`, truncates error messages). Auth helpers, accounts, alerts, analyze routes use it. Full-payload `console.log` in `app/api/sync/contracts` removed. AC grep for `accessToken|refreshToken|coverLetter|lastMessageText|passwordHash` in logs → none.
- **Found + fixed:**
  - `/api/analyze/cover-letter` had **no auth** (public proxy to our Gemini key). Now off unless `AI_SCORING_ENABLED=true` (→ 403 "disabled pending Upwork approval"), and needs a bidder session when on.
  - `/api/accounts`, `/api/alerts` (GET + PATCH) only had the proxy's signature check → now `requireAdmin()` (a stale/demoted admin cookie gets 401). Alerts PATCH no longer returns raw error text.
  - `/api/me/coverage?freelancerId=` returned every bidder's visits for that account → now scoped to the session member.
- Verified with curl: evil Origin gets `Allow-Origin: http://localhost:3000` (browser blocks); analyze → 403; stale admin cookie → 401 on accounts/alerts. Build ✅.

Flagged, not changed:
- `/api/me/accounts` shows every account's profile to every bidder (their own proposals/alerts only). There is no bidder→account assignment in the schema — ties to open question 1.
- Lint: 5 errors (`react-hooks/set-state-in-effect`) in `app/page.tsx` + `app/me/page.tsx` — **already on base branch**, not from this work. Fix in Phase I (AC needs lint clean).
- `app/api/admin/analysis` (Gemini) still admin-only and on; gate it in Phase F as the handover says.
- New env var `AI_SCORING_ENABLED` (default `false`) — add to `.env.example` in Phase J.

- Re-checked A + B against the handover line by line; browser-verified both dashboards after the auth change (admin overview + Team page, bidder `/me`), no console errors.
- `APP_BASE_URL`: prod = `https://upwork-tracking-tool.vercel.app` (confirmed). If unset, no CORS header is sent → same-origin only, dashboard still works.

### Phase C — extension shutdown ✅
- `lib/deprecated.ts` (new) → `extensionGone()` = 410 `{error:"deprecated", detail:"extension ingestion removed; see MCP migration"}`.
- 410 now: `/api/sync/{account,alert,contracts,freelancer-profile,proposal-detail,proposals}`, `/api/auth/verify`, `/api/coverage/visit`, `/api/bidding-criteria`, `/api/blocked-titles`, `/api/freelancer-profile`, `/api/admin/team/[id]/tokens`, `/api/admin/team/tokens/[tokenId]`. Old code stays in git history.
- `lib/member-auth.ts`: `resolveExtensionToken` always throws `extension_auth_removed` (401). Remaining extension-only routes that use it (`/api/coverage/pages`, `/api/nudges/pending`, `/api/nudges/ack-all`, `/api/nudges/[id]/ack`) now fail closed with 401 — not in the handover's 410 list, left as is.
- `scripts/revoke-extension-tokens.mjs` (new, has `--dry-run`): sets `revokedAt` on all active tokens.
- **Token UI choice:** did both — endpoints 410 *and* hid the Tokens column / "Manage tokens" in `components/admin/TeamView.tsx` (`EXTENSION_TOKENS_ENABLED = false`) so admins don't click something broken.
- `package.json` `ext` script prints a deprecation notice. `extension/` source kept in git.
- Verified: all 11 routes → 410, token endpoints → 410, Bearer token → 401, revoke script dry-run/real/dry-run = 1 → revoked → 0; Team page in Chrome shows no token controls. Build ✅.

Notes for later phases:
- Nudges (admin → bidder) were delivered only through the extension; no delivery channel now. Decide in Phase G (e.g. show on `/me`).
- Bidder dashboard still has "Pages to open", "Unscanned Proposals", "Extension Guide" menu items — extension-era; handle in Phase G.
- Now-unused helpers: `lib/tokens.ts`, `resolveAccount`/`withAttribution` in `lib/attribution.ts`. Delete in the follow-up cleanup with the legacy tables.
- Lint pre-existing errors also in `components/` (same `set-state-in-effect` rule, e.g. TeamView line 61 on base) → Phase I.
- **Before running on staging/prod:** run `revoke-extension-tokens.mjs` there (dry run first).

## Open questions (waiting on CEO / Upwork)
1. How will Upwork accounts connect via MCP when one bidder bids from multiple accounts? (needs research — affects `UpworkConnection` 1:1-per-member design before Phase D)
2. ~~Turn extension off now or later?~~ Resolved: extension is already not live → Phase C can proceed.
3. Upwork approval for hosted client / scheduled sync / storing MCP output — who contacts Upwork support?
4. ~~Production app URL?~~ Resolved: `https://upwork-tracking-tool.vercel.app` → set `APP_BASE_URL` to this in Vercel (prod).

## Findings
- Upwork MCP server is live. OAuth discovery (`https://mcp.upwork.com/.well-known/oauth-authorization-server`) shows: PKCE S256, refresh + revocation endpoints, dynamic client registration (`https://www.upwork.com/register`). Resolves handover §11 Q2 in principle; still verify before enabling.

## Local dev quickstart
```bash
nvm use 22                      # or: export PATH=~/.nvm/versions/node/v22.22.2/bin:$PATH
docker start upwork-pg          # local Postgres on :5433
npm run dev                     # uses .env.local (local DB) over .env
# local test logins: admin@local.test / adminpass123 (admin), bidder@local.test / newbidder123 (bidder)
# schema changes → DATABASE_URL=postgresql://upwork:upwork@localhost:5433/upwork npx prisma db push
```
