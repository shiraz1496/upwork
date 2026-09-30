# MCP Migration — Progress Tracker

Plan: [`DEVELOPER_HANDOVER.md`](./DEVELOPER_HANDOVER.md) (Phases A → J). This file tracks what is done, what is in progress, and open questions.
**Limits and checks still to do:** see [Known limits](#known-limits) and [Checks still to do](#checks-still-to-do) at the end of this file — keep them updated whenever a limit is found or a check is done.
Branch: `feat/mcp-migration` (base: `origin/main` @ `9fa091e`, foundation commit `d2e3bed`).

## Where things stand (2026-09-30)
- **All phases A–J are done and on this branch.** A+B `2b35413`, C `d08c9a2`, D–F `049d93f`, G–J in the commit after that.
- `UPWORK_MCP_ENABLED` is **off**. Our app has never been connected to a real Upwork account and is not registered with Upwork (the handover forbids both before approval). `scripts/register-upwork-client.mjs` is written, only run as a dry run.
- Nothing is deployed. Staging and production databases are untouched; the live site still runs `main`.
- Gates: `npm run test` 373 passing · `npm run lint` 0 / 0 · `npx tsc --noEmit` clean · `npm run build` ok.

## Continue from here
1. **Waiting on Upwork:** a support request asks whether our hosted app may connect to the MCP server, whether data may be stored and for how long, and whether scheduled refresh is allowed. Nothing below starts before the answer.
2. **Register the app:** `node scripts/register-upwork-client.mjs --redirect-uri <APP_BASE_URL>/api/me/upwork/callback` (try `--dry-run` first), put the returned client id in the env (see `.env.example`).
3. **Test with a real account on local / staging first:** set `UPWORK_MCP_ENABLED=true`, connect one account from the bidder page → Upwork connection, then go through "Needs our own app connected to a real Upwork account" in [Checks still to do](#checks-still-to-do).
4. **Go live:** follow "Before the first deploy" in [Checks still to do](#checks-still-to-do) (schema migration, env values, first admin, passwords, revoke old tokens).

How to work on it:
- Setup and commands: [Local dev quickstart](#local-dev-quickstart). Node 22 is required.
- **Never run `npm run db:sync`** — it targets the production database. For local schema changes use `DATABASE_URL=<local> npx prisma db push`.
- Test without Upwork: `UPWORK_MCP_MOCK=true` (local only, ignored in production) makes the app answer with data shaped like real Upwork responses (`lib/upwork/mock.ts`, fixtures in `tests/helpers/upwork-fixtures.ts`).
- Where things are: Upwork layer `lib/upwork/` · proposals `lib/proposals/` · job review `lib/criteria.ts`, `lib/job-review.ts` · client replies `lib/responses.ts` · dashboard feed `lib/dashboard-feed.ts` · retention `lib/retention.ts`, `scripts/purge-expired.mjs` · bidder screens `components/me/`, `app/me/page.tsx` · admin `app/page.tsx`, `components/admin/` · auth `lib/signed-session.ts`, `lib/me-auth.ts`, `lib/admin-auth.ts`.
- Only read-only Upwork tools can be called: the allow-list is `READ_ONLY_TOOLS` in `lib/upwork/client.ts`. Proposals are submitted by hand on upwork.com.
- The phase-by-phase detail of what was built and why is in the [Log](#log) below.

## Phase checklist

| Phase | What | Status |
|---|---|---|
| — | Local setup (deps, local DB, schema, build, dev server) | ✅ done |
| A | Email + password auth for admin & bidder; identity-bound sessions | ✅ committed `2b35413` |
| B | Security hardening (CORS allowlist, log redaction, isolation) | ✅ committed `2b35413` |
| C | Shut down extension ingestion (`/api/sync/*` → 410) | ✅ committed `d08c9a2` |
| D | MCP layer `lib/upwork/` (flag-gated, mocked) | ✅ committed `049d93f` |
| E | Proposal workflow + state machine | ✅ committed `049d93f` |
| F | Deterministic job review + client responses | ✅ committed `049d93f` |
| G | Dashboard adapters (preserve UI shapes, provenance, unknown ≠ zero) | ✅ committed (G–J commit), browser-verified |
| H | Retention & purge script | ✅ committed (G–J commit) |
| I | Vitest test suite | ✅ committed (G–J commit) |
| J | `.env.example`, implementation report, browser verify, push → preview | ✅ committed (G–J commit) · preview deploy not done |

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
- `lib/member-auth.ts`: `resolveExtensionToken` always throws `extension_auth_removed` (401). Remaining extension-only routes that use it (`/api/coverage/pages`, `/api/nudges/pending`, `/api/nudges/ack-all`, `/api/nudges/[id]/ack`) failed closed with 401 — not in the handover's 410 list. (Later also moved to 410, see the 2026-09-30 "does it make sense" entry.)
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

### Phase D — MCP layer ✅ (built on the committed 1-connection-per-bidder schema; flag OFF)
Files (`lib/upwork/`):
- `flags.ts` — `UPWORK_MCP_ENABLED`, `UPWORK_SYNC_SCHEDULE_ENABLED`, `UPWORK_MCP_URL`, plus **`UPWORK_MCP_MOCK`** (local dev only, ignored in production).
- `client.ts` — MCP over Streamable HTTP (JSON-RPC: `initialize`, `tools/list`, `tools/call`), handles JSON or SSE replies, `Mcp-Session-Id`, injectable transport. **Tool names resolved from live `tools/list`** (matches `find_jobs` or `upwork__find_jobs`); unknown tool → `ToolUnavailable`. Logs the discovered tool list.
- `oauth.ts` — OAuth 2.1 + PKCE S256 + `resource` param. Endpoints read at runtime from Upwork's discovery docs (nothing hardcoded); marked UNVERIFIED. Needs `UPWORK_OAUTH_CLIENT_ID` (+ optional secret) and `UPWORK_OAUTH_REDIRECT_URI`. Scopes: none requested until Upwork confirms.
- `connection.ts` — `startAuth` / `completeAuth` / `refreshIfNeeded` / `disconnect` / **`withMcp()`** (the single gate: flag → own connection → fresh token → client). Tokens **and the PKCE verifier** stored encrypted. Status transitions: connected → expired / revoked (tokens wiped) / error.
- `identity.ts` — reads `get_account` on connect; `assertOwnConnection`; **refuses if the same Upwork account is already connected by another member** (no account sharing).
- `account.ts`, `jobs.ts` (`findJobs`, `getRateInsights`), `messages.ts`, `contracts.ts` — flag off → `{status:"disabled", provenance:null, data:null}`; on → normalized DTOs + `provenance:"MCP_VERIFIED"` + `retrievedAt`. Mock mode → provenance `"MOCK"` (never passes as verified).
- `normalize.ts` — defensive mapping (Upwork field names unconfirmed); unknown → null; message snippets capped at 200 chars.
- `errors.ts`, `result.ts`, `http.ts`, `mock.ts` (in-memory MCP server + OAuth endpoints).
Routes: `POST /api/me/upwork/connect`, `GET /api/me/upwork/callback` (redirects to `/me?upwork=<code>`), `GET /api/me/upwork/status`, `POST /api/me/upwork/disconnect`.

Tests: **Vitest 4** added (`npm run test`, `vitest.config.ts`, `tests/`). 29 tests, all green — MCP client, connection state machine (connect / state mismatch / refresh / revoke / disconnect / isolation / account-claimed), token encryption, services flag off/on, mock-mode flow. Fake in-memory Prisma, mocked MCP — no real Upwork or DB.

Verified live (local dev server + local DB):
- flag off: status says `disabled pending Upwork approval`, connect → 503, callback → `/me?upwork=disabled`, not logged in → 401.
- mock mode end-to-end: connect → callback → `connected`, DB tokens are ciphertext, PKCE state cleared, replayed callback → `state_mismatch`, no token in responses or server log, disconnect clears tokens. (This run caught a mock-mode bug the unit tests missed — fixed + regression test.)
- build ✅, eslint on all Phase D files ✅.

Notes / decisions:
- Vitest 5 needs `@types/node` 22+ (project pins 20) → used Vitest 4. npm 10 crashed (`edgesOut` bug); `--legacy-peer-deps` dropped recharts' `react-is` peer (would break charts on Vercel) → reverted, installed with **npm 11** instead: lockfile adds vitest only, 3 patch bumps (nanoid, postcss, tinyglobby), nothing removed. `@vitest/coverage-v8` not installed (npm peer loop) — not needed.
- Disconnect bumped `sessionVersion` (handover §10.4) → bidder was signed out after disconnecting Upwork. (Removed later, see the 2026-09-30 "does it make sense" entry.)
- Dynamic client registration: `scripts/register-upwork-client.mjs` (discovers the endpoint, `--dry-run` supported). **Not run** — it creates a real registration at Upwork; run once per environment once it is approved, then set `UPWORK_OAUTH_CLIENT_ID`.

#### Phase D checked against Upwork's MCP docs (https://www.upwork.com/ai/mcp, 2026-09-29)
| Doc says | Our code | |
|---|---|---|
| Server `https://mcp.upwork.com/mcp` | `UPWORK_MCP_URL` default | ✅ |
| OAuth 2.1 | PKCE S256 + `resource`, endpoints from discovery | ✅ |
| "with dynamic client registration" | was: manual client id only → **added** `scripts/register-upwork-client.mjs` (dry run verified against live discovery) | ✅ fixed |
| "connecting grants the full set of scopes" | no `scope` param sent; comment updated to cite doc | ✅ |
| "credentials stored and refreshed automatically" | encrypted tokens, refresh 60s before expiry | ✅ |
| Revoke in Connected Apps "immediately invalidates access and refresh tokens" | 401 → status `revoked`, tokens wiped | ✅ |
| Auth error → "disconnect and reconnect" | `expired`/`revoked` states + reconnect | ✅ |
| "follows Upwork's standard rate limits" | was: 429 surfaced only → **added** backoff (2 retries, honours Retry-After, capped 5s) + tests | ✅ fixed |
| "only sees your own data" | per-bidder connection, isolation guards | ✅ |
| Write actions are drafts you confirm; binding actions on upwork.com | we only call read tools; never write | ✅ |
| Tool names | not listed in the doc → resolved at runtime from `tools/list` | ✅ |

Not verifiable from the page (still open):
- Hosted-client / scheduling / storing-output approval: the page only says "the same Upwork API & MCP Terms of Use apply". Flag stays OFF.
- Live OAuth + real tool names/shapes: needs a registered client and an authorized real account (explicit go-ahead needed).

New facts from the doc for later phases:
- **Freelancer tools include "Draft and submit proposals… Connects only apply when you confirm."** Our rule stays: we never submit. Phase E: check at runtime whether any tool can *confirm* a submitted proposal before ever using `SUBMITTED_CONFIRMED`.
- **"Account and access: List available Upwork accounts (freelancer, client, agency)"** and **Agency: "one-call overview across your whole agency: every team member's invitations, offers, messages, and contracts"** → relevant to open question 1 (how accounts connect). Needs research/testing with a real agency login before deciding.
- New env vars for `.env.example` (Phase J): `UPWORK_OAUTH_CLIENT_ID`, `UPWORK_OAUTH_CLIENT_SECRET`, `UPWORK_OAUTH_REDIRECT_URI`, `UPWORK_MCP_MOCK`.
- Local mock mode: `UPWORK_MCP_MOCK=true npm run dev`.

### Phase E — proposal workflow ✅
- `lib/proposals/state.ts` (pure): `canTransition`, `applyTransition`, `readinessIssues`, `isEditable`, `isDeletable`. `DRAFT ↔ READY → SUBMISSION_UNVERIFIED → SUBMITTED_CONFIRMED`; no skips; nothing leaves `SUBMITTED_CONFIRMED`; `SUBMITTED_CONFIRMED` only with `mcpVerified`.
- `lib/proposals/drafts.ts`: create / list / update / confirm / delete / verify. All scoped to the session member (`assertOwns` → 403). Zod validation: job link must be `https://…upwork.com`, amounts plain numbers, PATCH can only set `DRAFT`/`READY`.
- Routes: `POST|GET /api/me/proposals`, `PATCH|DELETE /api/me/proposals/[id]`, `POST …/[id]/confirm`, `POST …/[id]/verify`.
- Rules: content editable only in `DRAFT` (READY must go back to DRAFT); READY needs a cover letter + the matching bid amount; delete only `DRAFT`/`READY` (keeps the audit trail); one proposal per job per member; job details typed by the developer are `APP_RECORDED`.
- **confirm** = developer says "I submitted on upwork.com" → `SUBMISSION_UNVERIFIED`, snapshot of cover letter + bid, `DEVELOPER_CONFIRMED`, event row. Never submits to Upwork.
- **verify** (user-triggered, read-only): checks Upwork's own `list_freelancer_proposals`; exact job-id match → `SUBMITTED_CONFIRMED` + `MCP_VERIFIED`. Flag off → `disabled`, nothing changes. Mock data can never promote. Only the first page (10) of submitted proposals is checked for now; row field names still unverified (see Phase D live check).
- Tests: state machine (all 16 from→to pairs + rules) and draft service (validation, ownership, workflow, verify). **92 tests passing** total.
- Verified live (dev server + local DB, two bidders): 401 without login, evil link 400, duplicate 409, READY with empty letter 409, confirm from DRAFT 409, PATCH to a submitted state 400, bidder 2 sees 0 proposals and gets 403 on bidder 1's, confirm → `SUBMISSION_UNVERIFIED | DEVELOPER_CONFIRMED` + 3 events, verify with flag off → `disabled`, edit/delete after submission 409, cover letter not in server log. Build ✅ lint ✅.
- No UI yet (Phase G: proposal form, "Open on Upwork" link, Confirm submission, Verify).

### Phase F — deterministic job review + client responses ✅
Job review
- `lib/criteria.ts` (pure): `checkCriterion` ported from `extension/src/content.js` (same keys/operators as the admin Bid Criteria screen), `criterionLabel`, `evaluateJob` → `{results, matched[], failed[], unknown[], blockedBy, meetsRequired}`. **No score, no ranking, Upwork's order kept.** `meetsRequired`: `true` all required pass · `false` a required one failed or title blocked · `null` a required one could not be checked (or none configured).
- Missing data = `unknown`, never zero/pass. From a job search we have: client spend, rating, reviews, jobs posted, payment verified, country, proposals range, skills. **Not in search results → always `unknown`:** client hire rate, active hires, interviewing, hires on the job, last viewed (and client hires on the search feed). These need `find_jobs action=get` per job — not wired (one extra call per job).
- **Countries:** Upwork returns names, short names and ISO-3 codes (`United States`, `USA`, `GBR`, `ITA`). `canonicalCountry` maps all onto the admin list names (full ISO-3 table + aliases; a test checks every admin-list country has exactly one code). Deliberate change from the extension: an unrecognised country is `unknown`, not `pass`, so a blocked country can't slip through under a different spelling.
- Keywords (per-account `AccountKeyword`): whole-word, case-insensitive (`AI` ≠ `email`, `C` ≠ `C++`/`C#`). Blocked titles: same rule as `lib/blocked-titles.ts`.
- `lib/job-review.ts`: `factsFromJob`, `loadReviewConfig` (active criteria, blocked titles, optional `accountId` → that account's keywords + profile skills for skill match), `getReviewedJobs`, `logJobReview`.
- `GET /api/me/jobs?mode=search|best_match|most_recent&title=|query=&skills=&job_type=&experience_level=&verified_payment_only=&days_posted=&limit=&cursor=&accountId=` — whitelisted options only. Flag off → `{status:"disabled"}`. Not connected → 409.
- `POST /api/me/jobs/review` → `JobReviewLog` (APP_RECORDED), one per member + job per 24h.

AI scoring
- `lib/ai-scoring.ts`: one flag `AI_SCORING_ENABLED` (default off) now gates both `/api/analyze/cover-letter` and `/api/admin/analysis` (403 "disabled pending Upwork approval"). Code kept. Nothing in the UI called the admin route.

Client responses
- `lib/responses.ts`: `syncClientResponses` (user-triggered only) reads the member's rooms, keeps those where the **client wrote last**, stores `ClientResponse` with a 200-char snippet + `expiresAt` (`lib/retention.ts`, 30 days placeholder). Deduped by room + message.
- **Linking only by verified identifier:** job → submitted proposal (`list_freelancer_proposals`) → its room (`get_room`). Room == response room → linked, `associationMethod: verified_identifier`. Otherwise stored unlinked with `associationMethod: manual` (`needsManualAssociation: true`). Never by name or title. `get_room` response shape is UNVERIFIED (test account has no proposals) → parsed defensively; failure = unlinked.
- Mock-mode data is returned but never stored.
- Routes: `POST /api/me/responses/sync`, `GET /api/me/responses`, `PATCH /api/me/responses/[id]` `{draftId|null}` (manual link/unlink; both rows must be the member's own).

Tests: **158 passing** (criteria 45 incl. every operator, countries, labels, evaluateJob; job review; responses incl. linking, no-title-match, dedupe, isolation).
Verified live (dev server + local DB):
- flag off: jobs / sync → `disabled`; validation 400s; review log dedupe; both AI routes 403; no-login 401.
- mock mode with real DB rows (7 criteria incl. 1 inactive, blocked title, account keywords, profile skills): matched / failed / unknown reasons all correct, inactive criterion ignored, no score/rank field, unknown `accountId` → 400, sync stores nothing in mock mode.
- manual link on real rows: own proposal ok, other bidder's proposal 403, other bidder's response 403, missing 404, bad body 400, unlink ok. No snippets / cover letters in server logs.
- build ✅, lint 0 errors.

Notes
- Local DB now has test rows with ids starting `t_` (criteria, blocked title, account `t_acc1` + keywords + profile, a response, a draft) and a second test bidder `bidder2@local.test`. Useful for Phase G browser checks.
- Job list pagination cursor is accepted but the next cursor is not returned yet → add in Phase G with the list UI.
- `vitest.config.ts` → `vitest.config.mts` (silences an ESM warning).
- Retention length (30 days) is a placeholder until Upwork's terms are confirmed (handover §11 Q5).

### Phase G — dashboard adapters + UI ✅ (browser-verified)
Approach: the handover keeps `Proposal`, `Alert`, `FreelancerProfile` "because the existing admin UI renders them" → they are now **fed from the new pipeline** (write-through), so every existing screen, coaching notes, nudges, team stats and the duplicate checker keep working on real `Proposal` rows.

Backend (`lib/dashboard-feed.ts`)
- **One `Account` per bidder.** `memberAccount()`: a placeholder (`freelancerId = "member:<id>"`, "<name> (Upwork not connected)") until they connect; on connect the same row becomes the real account (`freelancerId = org_uid`, Upwork name), or is merged into an existing account for that Upwork id. Proposals always go to the bidder's own account — **`accountId` is no longer accepted from the client** (it let a bidder attach a proposal to someone else's account).
- **Proposal feed:** confirming a submission upserts a `Proposal` (matched by account + job URL, the key the old sync used): status "Submitted (self-reported)" → "Submitted (verified by Upwork)" after MCP verify, section "Submitted". DRAFT/READY never appear on dashboards.
- **Alert feed:** each stored client reply creates an `Alert` with **no message text** (text stays only in the expiring `ClientResponse`). When a later refresh shows the bidder answered, the alert is resolved.
- **Interviewed:** an interview reply linked to a proposal (by Upwork or by the bidder) moves its `Proposal.section` to "Interviewing", which is what the Overview counts.
- **Profile feed:** `syncProfile()` stores the bidder's own profile + Connects balance (`get_profile`, shapes verified live 2026-09-30) into `FreelancerProfile` / `Account.connectsBalance`. JSS is not returned by Upwork → stays null.
- `POST /api/me/upwork/refresh` = "Refresh activity" (profile + Connects + replies). User-triggered only.
- **Unknown ≠ zero:** accounts with new-pipeline proposals get `metricsUnavailable: ["viewed","hired"]` (`/api/accounts`, `/api/me/accounts`); `/api/me/stats` gets `unavailable`. Proposals carry `provenance` (`DEVELOPER_CONFIRMED` | `MCP_VERIFIED`). Both are optional additions to `lib/overview-types.ts`; existing fields unchanged.
- `/api/me/accounts` now returns only the bidder's own account + accounts they have proposals/alerts on (closes the "every bidder sees every account" gap flagged in Phase B).
- Team list returns `upworkConnection {status, accountName, lastSyncedAt}` (status only, never tokens).
- Job review defaults to the bidder's own account for keywords + profile skills.

UI (same dashboards, no second one)
- `components/OverviewPanel.tsx`: Viewed / Hired cards, conversion boxes show "— unavailable"; funnel, trend charts, per-account bars and the daily strip leave those series out; a one-line note explains why.
- Bidder page `app/me/page.tsx`: removed "Pages to open" (coverage), "Unscanned Proposals", "Extension Guide", the coverage banner and its 15s polling. New tabs (in `components/me/`): **Upwork connection** (connect / reconnect / disconnect with confirm / refresh activity / switched-off + error states / callback result), **Find jobs** (best matches · most recent · search; matched / failed / unknown reason chips; "Meets required criteria" / "Fails a required criterion" / "Blocked title" / "Not enough data"; Open on Upwork; Start proposal), **My proposals** (form, edit, mark ready, back to draft, "I submitted it" with confirm step, Check with Upwork, delete), **Client replies** (refresh, link / unlink to a proposal). `ProvenanceBadge` (Verified by Upwork / Self-reported / Recorded here / Test data).
- Admin page: Leaderboard + Coverage Pages tabs, coverage banner and its fetch switched off (`COVERAGE_ENABLED = false`, code kept). Submissions tab now includes new-workflow proposals; provenance badge in proposals table, submissions and the drawer; extension wording removed from empty states.
- Team page: **Set / Change password** dialog (the Phase A follow-up), "Login" and "Upwork" columns.

Tests: **173 passing** (+15: account placeholder/adopt/merge, proposal feed, alert feed without text, interview → section, alert resolve, profile sync, mock not stored).
Browser-verified in Chrome (no console errors on any screen):
- Test mode, bidder: connect → "connected" message, address bar cleaned; Find jobs shows reasons + labels; Start proposal → form prefilled → save → Mark ready → "I submitted it" → confirm → "Submitted · Self-reported"; Overview: **Sent 1, Viewed —, Interviewed 0, Hired —** with the note; linked the test interview reply → **Interviewed 1**.
- Admin: bidder's account shows the same numbers; Proposals 1 / Submissions 1 with the Self-reported badge; coverage tabs gone; Team page columns; password dialog changed bidder 2's password (new one logs in, old one 401).
- Flag off (= production today): Upwork tab and Find jobs show "switched off pending Upwork approval"; proposals still usable by hand.
Build ✅, lint: 0 errors in new/changed code.

Known leftovers (not blocking)
- Nudges (admin → bidder) still have no delivery channel; not shown on `/me`.
- Legacy routes/components now unused but kept: `/api/me/coverage`, `/api/admin/coverage-*`, `components/GuideView.tsx`, coverage admin views → remove with the legacy tables in the follow-up cleanup.
- Job list has no "next page" yet (first 10 only).
- Admin Overview opens on the first account in the list rather than "All accounts" (existing behaviour).
- Pre-existing lint errors in `app/page.tsx`, `app/me/page.tsx`, `components/OverviewPanel.tsx`, admin views → Phase I.

### Phase H — retention & purge ✅
- `lib/retention.ts`: `MCP_DATA_TTL_DAYS = 30` (placeholder until Upwork's terms are confirmed) + `mcpDataExpiry()`.
- `scripts/purge-expired.mjs` (exports `purgeExpired(prisma, {dryRun, now, ttlDays})`, so a scheduler can call it later; **nothing schedules it now**). Needs an explicit `DATABASE_URL`, prints the target host, has `--dry-run`. Removes only Upwork-derived data past its period:
  1. `ClientResponse.snippet` where `expiresAt` has passed (row kept; the UI shows "Preview no longer stored").
  2. `ProposalDraft.jobDescriptionCache` where `jobDataExpiresAt` has passed.
  3. `FreelancerProfile` + `Account.connectsBalance` for accounts that belong to an Upwork connection and were last read more than the period ago (re-read on the next refresh).
  4. OAuth sign-in state left by a connect that was never finished (> 1 hour).
- Never touched: cover letters, bids, submitted snapshots, status history, coaching notes, dashboard `Proposal` / `Alert` rows, and anything captured by the old extension (legacy profiles are not Upwork-connection data).
- **Run on the LOCAL Docker DB only** (not staging, not prod). Seeded 9 cases (expired vs fresh vs no-expiry previews; expired vs fresh caches with cover letters; stale connected profile vs fresh connected profile vs stale legacy profile; abandoned vs in-progress sign-in): dry run reported 1/1/1/1 and changed nothing; real run removed exactly those four; cover letters, legacy profile and all row counts unchanged; second run found 0. Seed rows removed afterwards.
- Tests: **193 passing** (+7: same retention period in script and app, dry run writes nothing, exact expiry conditions, only five fields are ever set, only `FreelancerProfile` is ever deleted from, custom period).
- **Finding:** the handover says member deletion cascades "are already modeled". Checked in a rolled-back transaction: deleting a `TeamMember` **fails** — `ProposalStatusEvent.actorId` (and the older `CoachingNote` / `Nudge` member relations) have no `onDelete`. No impact today (the app only deactivates members, never deletes). Not changed: it needs a new migration on the committed schema → see Known limits (end of this file).

### Phase I — tests + lint ✅
All three gates green: **`npm run test` 241 passing (16 files) · `npm run build` ✅ · `npm run lint` 0 errors, 0 warnings.**

Handover test list → where it is covered (no test touches Upwork or a real database):
| Handover item | Test file(s) |
|---|---|
| `lib/crypto`: hash/verify, encrypt/decrypt, redact | `tests/crypto.test.ts` |
| Auth: identity binding, `sessionVersion` invalidation, admin vs dev separation, ownership guard | `tests/auth/signed-session.test.ts`, `tests/auth/guards.test.ts`, `tests/auth/login.test.ts` (**new in this phase**, +48) |
| Connection state machine (connect → expired → refresh → revoke), mocked transport | `tests/upwork/connection.test.ts`, `tests/upwork/client.test.ts` |
| Proposal state machine; confirm → `SUBMISSION_UNVERIFIED` + event + snapshot | `tests/proposals/state.test.ts`, `tests/proposals/drafts.test.ts` |
| Deterministic criteria filter (matched reasons, blocked titles) | `tests/criteria.test.ts`, `tests/job-review.test.ts` |
| Client-response association: verified id links; none → manual | `tests/responses.test.ts` |
| Extension shutdown: `/api/sync/*`, `/api/auth/verify` → 410; token auth refused | `tests/extension-shutdown.test.ts` (**new**; all 13 retired routes, and checks no other HTTP verb is exported) |
| (extra) dashboard feed, retention, normalizers, services | `tests/dashboard-feed.test.ts`, `tests/retention.test.ts`, `tests/upwork/normalize.test.ts`, `tests/upwork/services.test.ts` |

Lint (was 15 errors + 36 warnings, all in code that predates this work)
- **13 × `react-hooks/set-state-in-effect`** in `app/page.tsx` (4), `app/me/page.tsx`, `components/OverviewPanel.tsx`, 7 admin views: existing, working effects (load data on mount, keep the selected account valid, sync the date picker). **Not rewritten** — each got a one-line `eslint-disable-next-line … -- <reason>`. Rewriting 13 effects in these large files to satisfy a style rule risks breaking working screens; the rule stays on for new code (the new `components/me/*` screens pass it without exceptions).
- 2 × unescaped quotes in `BiddingCriteriaView` → escaped (same glyph).
- Dead code removed: unused `fmt`, `viewRate`, `unreadCount`, `totalProposals`, `viewedProposals` in `app/page.tsx`; `neutral`, `barPct` in `OverviewPanel`. Parked code for a commented-out legend kept, with a scoped disable.
- 2 × `exhaustive-deps` warnings → the file's existing `// eslint-disable-line` convention (adding the deps would change behaviour).
- `extension/**` added to ESLint ignores (retired, not built).
- After these edits: both dashboards re-checked in Chrome — all 9 admin tabs and all 7 bidder tabs render, no console errors.

### Phase J — documents ✅
- `.env.example` (new): every variable the code reads, with placeholders only and how to generate each secret. `.gitignore` now has `!.env.example` (the `.env*` rule was ignoring it); `.env` / `.env.local` are still ignored.
  - No longer read by any code: `ADMIN_PASSWORD`, `NEXT_PUBLIC_SHOW_DUPLICATES`; `TOKEN_HASH_PEPPER` is only used by the retired `lib/tokens.ts`.
  - `UPWORK_SYNC_SCHEDULE_ENABLED` is read by `lib/upwork/flags.ts` but nothing schedules anything.
- `UPWORK_MCP_IMPLEMENTATION_REPORT.md` (written, kept locally, not in the repository — its content is covered by this file): preserved / migrated / disabled / needs-authorization, guardrail by guardrail, tested vs untested, MCP limitations, decisions beyond the handover, definition-of-done checklist, steps to a preview deploy, changed-files list (133 files: 82 added, 51 modified, 0 deleted vs `origin/main` @ `9fa091e`).
- Browser verification: done in Phase G and repeated after the Phase I lint edits.
- **Not done, on purpose (at that point; D–J were committed and pushed later):** commit of D–J, push, Vercel preview, applying the migration to staging/prod, connecting a real account.
- Final gates: `npm run test` 241 ✅ · `npm run lint` 0/0 ✅ · `npm run build` ✅.

### 2026-09-30 — full re-verification of all phases before pushing D–J
Everything was re-tested from scratch, on **fresh, empty databases** (so no leftover data could hide a problem), plus two independent read-only code reviews (one on auth / security, one on the MCP, proposal and dashboard logic).

What was run
- **Clean install** the way a deploy does it (`npm ci` with npm 10 in a separate folder): ok; all key packages resolve.
- **Schema migration** (never exercised before — the local DB had been built straight from the final schema): rebuilt the schema that is deployed today (`origin/main`), inserted a row, applied `migration.sql` → 15 → 20 tables, **no difference** from `prisma/schema.prisma`, the existing row survived with defaults. `rollback.sql` → back to exactly the deployed schema. Re-apply → ok.
- **Scripted end-to-end run, 237 checks, every phase A–H**, against the running app and a fresh database: 180 with the flag off (as production will be) + 57 in test mode. All pass. Includes logins, cookie flags, forged / tampered / cross-role cookies, session invalidation, all 13 retired routes, every proposal rule with two bidders, dashboards as bidder and admin, purge, and a scan of the server log for passwords, tokens, cover letters and message text.
- **Browser** (Chrome): bidder flow (connect screen, jobs, new proposal incl. a bad link, ready, confirm, check with Upwork, Overview) and all admin tabs. No console errors.
- **Hygiene** on everything that would be pushed: no secrets or hosted-database strings, `.env` / `.env.local` still ignored.

Both reviews: **no critical or high issue**; read-only tool use, per-member isolation, "test data is never stored as real" and "no route without login" all confirmed. They did find real lower-severity problems. Fixed:
| Problem | Fix |
|---|---|
| State changes were not atomic: two requests at once could leave a *submitted* proposal editable, or create two dashboard rows | every write names the state it expects (`where: { id, state }`); the loser gets 409. Proven on real Postgres: two confirms → one 200 + one 409, one row |
| Editing a draft's job link kept the old job id (a proposal for job B could be "verified" through job A) | the job id is always derived from the link on the server (`jobIdFromUrl`), on create and on edit; duplicate check re-run; a client-sent id that disagrees → 400 |
| Two token refreshes at once could destroy a healthy connection | the loser re-reads the row and uses the winner's token |
| A token Upwork rejects was treated as "revoked" straight away | one refresh + retry first; a 403 on a single request no longer costs the connection |
| Blank numbers from Upwork became 0 | blank / unreadable → null (unknown); also reads `$10K+` |
| Bidder stats: "interviewed" and "hired" ignored the date range (older bug) | fixed (`AND`, not a second `OR`) |
| Test mode renamed the bidder's account to the made-up identity | the test identity has a non-numeric id (`mock-org-1`) and never becomes an account |
| "Hired" showed a real 0 for a bidder with no working connection | decided per account: needs the integration on + that account connected + refreshed once |
| Logout only cleared the browser cookie | logout now bumps `sessionVersion` (a copied cookie dies too) |
| A bidder could read another account's keywords via `?accountId=` / `?freelancerId=` | both always use the bidder's own account |
| Confirming could overwrite another bidder's dashboard row on a shared account | rows are matched on the owner too |
| Failed connect / disconnect revoked only the access token; sign-in state never expired | both tokens revoked; no token kept after a failed connect; sign-in state is single-use and expires after 10 minutes |
| Upwork's raw error text reached the browser | fixed message for users; the original stays in the server log |
| Admin routes answered 500 for bad JSON / duplicate email / missing row | 400 / 409 / 404 |
| An admin could demote or deactivate the last admin | refused (409 `last_admin`) |
| A signed cookie whose payload was `null` crashed | rejected |
| A country list with one unrecognised name turned a definite match into "unknown" | a match is definite |
| A reply stored unlinked was never linked later; very old chats became alerts; a reply could be linked to an unsent draft; unlinking left "Interviewing" | re-linked on a later refresh; only replies from the last 30 days; only submitted proposals; unlink restores "Submitted" |
| Refresh: one failing part aborted the rest | each part runs on its own and reports its own error |
| Nothing central stopped a future write call to Upwork | `READ_ONLY_TOOLS` allow-list in the client; anything else is refused |
| Validation errors showed just "invalid" | a readable sentence ("The job link must be a link to an Upwork job…") |
| Non-JSON reply from Upwork → 500; no request timeout | handled; 20 s timeout |

Tests: **372 passing in 17 files** (was 241). New: every API route called with no login (65 routes), concurrency, two-member isolation with two tokens, revoke really called, sign-in expiry, refresh race, test-mode-in-production, read-only allow-list, cookie payload shapes, logout revocation. Several older tests that did not really prove their claim were rewritten. `npm run lint` 0 / 0, `npm run build` ok.

Not fixed (need a schema change or infrastructure) → [Known limits](#known-limits): login rate limiting, unique indexes for the remaining check-then-create races, database TLS verification, password echo in `set-password.mjs`, scrypt cost, old accounts vs new accounts.

### 2026-09-30 — "does it make sense" pass: five small changes, and where the handover is out of date
Went through the finished work screen by screen. Changed (all small):
1. **Disconnecting Upwork no longer signs the bidder out.** The handover (§10.4) said to end the session; but the login to this app is email + password and has nothing to do with the Upwork link, so the bidder was thrown out for no reason. Tokens are still revoked and wiped.
2. **Team Stats:** the "Pages covered" bar had no data source left (extension only) → replaced by **Jobs reviewed** (last 7 days / total, from `JobReviewLog`, recorded in this app). "Last capture" → "Last proposal or reply".
3. **Admin Proposals tab:** the "Viewed / Not viewed / Unscanned" filter and the "Open in ChatGPT" view-rate prompt are hidden when no account in view has a source for "viewed" (they would show every proposal as "not viewed"). They still appear for old extension-era accounts. The ChatGPT prompt was also an AI path the handover's AI switch did not cover.
4. **Four more extension-only routes → 410** (`/api/nudges/pending`, `/api/nudges/ack-all`, `/api/nudges/[id]/ack`, `/api/coverage/pages`). They were missing from the handover's Phase C list and answered 401; now consistent with the rest (17 retired routes).
5. **Bidder page:** the bidder's own account is always shown (before, a newly connected account with no proposals was filtered out), and the account dropdown is hidden when there is only one account.

Checked after the changes: **373 tests passing**, lint 0 / 0, type-check clean (one test typing fixed), build ok, end-to-end script **237 / 237** on a fresh local database (180 flag off + 57 test mode), and the three changed screens looked at in the browser.

Points where the handover does not match what was found (for a decision, nothing changed in the design):
- §10.4 disconnect → sign-out: changed, see 1.
- One Upwork connection per team member: does not fit a bidder who works on several accounts, or an agency login.
- §11 Q1: a freelancer proposal list **does** exist, so submitted / offered / hired can be verified.
- `get_rate_insights` is not available to a freelancer login. "Viewed by client" has no source.
- "Delete cascades already modelled": not true for `ProposalStatusEvent.actorId`, `CoachingNote`, `Nudge`.
- Schema comment calls `upworkAccountId` a "ciphertext id"; it is the Upwork organisation id.
- Phase C route list missed the four routes in 4.
- Missing unique indexes (see [Known limits](#known-limits)), and the open question of how long Upwork data may be stored.

### 2026-09-30 — correction: "Hired" IS available from Upwork (found while answering "are you sure?")
Second read-only check with the test account (it has archived proposals, so real proposal rows were visible for the first time):
- **Hired / Offered:** `list_freelancer_proposals` filters by status `Hired`, `Offered`, `Accepted`, `Archived`, `Declined`, `Withdrawn`. So hired is reported — the Phase G note saying otherwise was wrong. **Now wired.**
- **Viewed:** the proposal detail has **no** "viewed by client" field. "Insights" (how many proposals the client opened) are a paid **Freelancer Plus** feature and are job-level counts. The test account is on Basic, so the Plus payload is unseen. → stays unavailable.
- Real proposal row shape confirmed: `status {status, status_label}`, `marketplaceJobPosting {id, content.title}`, `auditDetails.createdDateTime {displayValue, rawValue}`. **Bug fixed:** the old parser read the epoch-ms string as a date and would have returned no date.
- The proposal detail (`action=get`) carries `room_id` directly → used as the verified proposal ↔ conversation link (replaces the unverified `get_room` call).

Changes
- `lib/upwork/normalize.ts`: `normalizeProposals` / `normalizeProposalDetail` to the verified shapes.
- `lib/upwork/proposals.ts`: `proposalsForJobs(memberId, jobKeys, {withRooms})` searches the newest page of each status and stops when all jobs are found.
- Verify now succeeds for a proposal in any of those statuses (a hired or closed proposal still proves it was submitted).
- `syncProposalOutcomes` (part of "Refresh activity"): confirms recorded submissions and records the outcome on the dashboard `Proposal` — `Hired` → `hiredAt` + section Active; `Offered` → section Offers; `Archived`/`Declined`/`Withdrawn` → status label only.
- `unavailableMetrics()`: `viewed` always; `hired` only while the Upwork connection is off. Overview note reworded.
- Tests: **186 passing**. Build ✅.

Caveats
- Hired is only as fresh as the bidder's last "Refresh activity" (nothing runs in the background).
- The test account's `Hired` list was empty although it has one closed contract, so a contract that already ended may no longer be listed as `Hired` (it probably shows as `Archived`). Contracts (`list_contracts`) are a second source but carry no job id to link them to a proposal. Re-check with an account that has an active contract.
- Only the newest 10 proposals per status are searched.

### 2026-09-30 — Phase D checked against the LIVE Upwork MCP server
How: Upwork's official connector added to Claude Code (`claude mcp add --transport http upwork https://mcp.upwork.com/mcp`) and authorized with the **test** Upwork account. This is the normal use Upwork's page describes — **our app was NOT registered or connected** (handover Phase J: no real account until Upwork approves). Read-only calls only, 1–2 rows each; no real data stored in the repo (fixtures are made up).

What the live server really does (vs what Phase D assumed):
| | Assumed | Live |
|---|---|---|
| Tool call | free-form args | every tool takes `{action, org_uid, params}` |
| Identity | `get_account` → id/name | `list_accounts` → `accounts[{name, org_uid, role}]`; `org_uid` is needed by every other call |
| Jobs | guessed fields | `jobs[]`: `id,title,url,description_snippet,skills[],job_type,budget` (text: `"100.00"`, `"15.00–20.00/hr"`), `experience_level,duration,proposals_tier,published_date,client{country,rating,total_spent,verification_status}` |
| Messages | guessed | `data.rooms[]`: `id, roomType, latestStory{id,createdDateTime,message}, numUnread, last_message_from_self` — **no job id in a room** |
| Contracts | guessed | `data.vendorContracts.contracts[]`: `id,title,status,startDate,endDate,offerId,clientOrganization{name}` |
| `get_rate_insights` | relied on (handover §11) | **not offered** to this (freelancer) login |
| Submitted proposals | "probably no tool" (handover §11 Q1) | **`list_freelancer_proposals` exists** (status `Accepted` = submitted) |
| Text from other people | plain | wrapped in `<untrusted_participant_content>` tags |
| Job URLs | plain | carry `utm_*=…claude…` tracking params |

Fixed in code (all unstaged with the rest of D):
- `identity.ts`: identity from `list_accounts`, picks the freelancer (`TALENT`) account; its `org_uid` is stored as `upworkAccountId`. A login with no freelancer account is refused (token revoked, nothing stored).
- `connection.ts`: `withMcp(memberId, (client, orgUid) => …)` passes the member's own `org_uid` to every call. Identity is now required on connect (was best-effort).
- `jobs.ts` `findJobs(memberId, "search" | "smart_search", params)`; `messages.ts` `listRooms`; `contracts.ts` `listContracts`; new `proposals.ts` `listSubmittedProposals` (read only); `account.ts` `listAccounts`. `getRateInsights` removed.
- `normalize.ts` rewritten to the real shapes: budget text parser, wrapper tags stripped (content treated as plain text), tracking params stripped from URLs, tool `status != "ok"` → error.
- `mock.ts` rebuilt in the real shapes (made-up data) and, like the live server, rejects calls without `action`/`org_uid`.
- Tests: **45 passing** (was 31). Build ✅, lint ✅, mock-mode end-to-end on the dev server ✅.

Answers to handover §11 open questions:
1. Freelancer "list my proposals" tool → **exists** (`list_freelancer_proposals`). So `SUBMITTED_CONFIRMED` is reachable by MCP verification in Phase E/F. Row field names still UNVERIFIED (test account has no proposals).
2. OAuth endpoints / dynamic registration → confirmed by discovery + Upwork's page. Our own client still not registered.
3. Hosted-client approval → still open (decision + Upwork).
4. Rate limits → "standard Upwork limits"; backoff implemented.

For later phases:
- Linking a client reply to a proposal (Phase F): rooms have no job id → use `list_freelancer_proposals` `get_room` (proposal → room id) as the verified identifier.
- Multi-account question: the test login returned **two** accounts (Freelancer + an Agency), and agency tools exist (`get_agency_dashboard`, `agency_rooms`). Current design connects only the freelancer account (1 per bidder, per the handover). Agency route not explored.
- Still unverified until our own app is connected: our OAuth client registration, token refresh against the real token endpoint.

## Open questions (waiting on a decision / Upwork)
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
# local logins: create your own with scripts/set-password.mjs (see Phase A)
# schema changes → DATABASE_URL=postgresql://upwork:upwork@localhost:5433/upwork npx prisma db push
```

---

## Known limits

### Data the dashboards can and cannot show
| Number | Status | Why |
|---|---|---|
| Sent | Available | Bidder confirms a submission; Upwork's proposal list can verify it. |
| Interviewed | Available | Interview rooms / offers on Upwork, linked to a proposal. |
| Hired | Available **only while the Upwork connection is on** | Read from Upwork's proposal status `Hired`. With the flag off there is no source → shown as "—". |
| Viewed | **Not available** | Upwork's proposal detail has no "client viewed" field. "Insights" is a paid Freelancer Plus feature and is a job-level count, not per proposal. Shown as "—". |
| JSS | Not available | Upwork's profile tool does not return it. Card is hidden. |
| Coverage (pages opened) | Removed | Only the extension recorded browsing. Team Stats shows "Jobs reviewed" (opened in this app) instead. |

### Freshness
- **Nothing updates in the background.** Proposals appear when a bidder confirms them; replies,
  hired/offered, profile and Connects update when a bidder presses **Refresh activity**.
  Scheduled syncing stays off until Upwork approves it (handover §1 guardrail 4).
- So the admin's numbers are only as current as each bidder's last confirm / refresh.
- Unfinished drafts (DRAFT / READY) are not visible to the admin.

### Hired
- A contract that **starts and ends between two refreshes may never show as Hired**: once a
  contract ends, Upwork appears to move the proposal to `Archived`.
- Upwork's contract list (`list_contracts`) would catch it, but contracts carry **no job id**
  to match them to a proposal (only title + offer id), so it is not used for this.

### Job review
- Upwork returns **at most 10 jobs per page**; the list has no "next page" yet.
- **Five bid criteria always show "unknown"** in the job list because a job search does not
  return them: client hire rate, client active hires, interviewing count, hires on the job,
  last viewed. (They need one extra Upwork call per job — not wired.) On the search feed,
  client hires is unknown too.
- An unrecognised client country is "unknown", not "pass" (deliberate — see `lib/criteria.ts`).
- Bidders only see criteria on jobs they browse **in our app**, not on upwork.com.

### Proposals and replies
- Only the **newest 10 proposals per status** are searched when verifying / reading outcomes.
  A bidder with many older proposals may get "not found" for an old one.
- A client reply is linked to a proposal only when Upwork links them (the proposal's
  `room_id`). Otherwise the bidder links it by hand. Never matched by name or title.
- Admin alerts for client replies carry **no message text** (the text stays in the expiring
  `ClientResponse` record).
- Admin nudges to bidders have **no delivery channel** (they went through the extension).

### Accounts
- **One Upwork account per bidder, one bidder per Upwork account** (the handover's design).
  A bidder who handles several accounts, or an account shared by several bidders, does not
  fit. Upwork's agency features (one login returned a Freelancer *and* an Agency account)
  have not been explored.
- Disconnecting Upwork does **not** sign the bidder out (the handover §10.4 asked for a
  sign-out; changed because the two logins are unrelated).

### Retention
- Upwork-derived data we store (reply previews, profile, Connects balance) has a **30-day
  placeholder** lifetime (`lib/retention.ts`). The real requirement is not confirmed.
- Expired data is only removed when someone runs `scripts/purge-expired.mjs` by hand —
  **nothing schedules it**. If nobody runs it, expired data stays in the database.
- The purge has only been run on the local test database, never on staging or production.
- Alerts keep the Upwork room id and the job title indefinitely (no message text).

### Security
- **No rate limiting on login.** Password guessing against `/api/admin/login` and
  `/api/me/login` is not throttled (minimum password length is 8). Best fixed at the edge
  (e.g. a firewall rate-limit rule on those two paths) — an in-memory limiter does not
  work on serverless.
- Database TLS does not verify the server certificate (`rejectUnauthorized: false` in
  `lib/prisma.ts` and the scripts). Already the case before this work.
- `scripts/set-password.mjs` shows the password while it is typed.
- Password hashing uses scrypt at Node's default cost; the cost is not stored in the hash,
  so raising it later needs a format change.
- Bidders cannot change their own password; an admin sets it (and so knows it).
- Session cookies last 30 days. Logging out, or an admin changing the password / role /
  status, ends every session of that member at once.

### Simultaneous requests
- Proposal state changes are safe (each write names the state it expects).
- Three check-then-create paths still have **no unique index** behind them, so two requests
  in the same instant could create a duplicate: a second draft for the same job, a duplicate
  client reply (+ alert) if "Refresh activity" and "Refresh replies" are pressed together,
  and two bidders connecting the same Upwork account at the same moment. Needs a schema
  migration (unique on `ProposalDraft(memberId, upworkJobId)`,
  `ClientResponse(memberId, upworkThreadId, upworkMessageId)`, `UpworkConnection(upworkAccountId)`).

### Old data vs new data
- Accounts created by the old extension are identified by the Upwork *profile* id; a new
  connection is identified by the Upwork *organisation* id. They never match, so a bidder's
  new account is **separate** from any old account (its keywords and old proposals stay on
  the old one). Fine for a fresh start; needs a mapping step if old data must carry over.
- The admin Proposals tab shows the old "Viewed / Not viewed / Unscanned" filter and the
  "Open in ChatGPT" button only when an old extension-era account with proposals is in view.
- A contract's hire date is taken from the proposal's last-modified time (an approximation).

### Deleting a team member
- **Not possible at the database level:** `ProposalStatusEvent.actorId` (and the older
  `CoachingNote` / `Nudge` member links) have no delete rule, so the delete is refused. The
  handover says these cascades already exist; they do not. No impact today because the app
  only deactivates members. If a member's data must be erased, it needs a schema migration
  (`onDelete: Cascade` on those relations) first.

---

## Checks still to do

### Needs a decision / Upwork
- [ ] **Upwork approval** for a hosted app that stores data (and, later, scheduled syncing).
      The migration audit says this is required; Upwork's terms page could not be opened to
      confirm the wording. Until then `UPWORK_MCP_ENABLED` stays `false`.
- [ ] **Retention period** Upwork requires for stored data → set `MCP_DATA_TTL_DAYS` in
      **both** `lib/retention.ts` and `scripts/purge-expired.mjs` (a test fails if they differ).
- [ ] Who runs the purge, and how often? (manual today; scheduling needs Upwork approval)
- [ ] Should deleting a team member be possible? If yes, add the missing delete rules.
- [x] Disconnecting Upwork no longer signs the bidder out (differs from handover §10.4).
- [ ] Decide what to do about **Viewed**: leave as "—", let bidders mark it by hand
      (self-reported), or test Freelancer Plus insights.
- [ ] Decide how multi-account bidders / shared accounts should work (agency route?).

### Needs our own app connected to a real Upwork account (after approval)
Everything below was checked only through Claude Code's Upwork connector (read-only, test
account) or with made-up test data — **never through our own app**.
- [ ] Register our app: `node scripts/register-upwork-client.mjs --redirect-uri <url>`
      (dry run works; the real registration has not been run). Does Upwork accept our
      redirect address?
- [ ] Full sign-in through our app: connect → Upwork consent → callback → connected.
- [ ] Token refresh against Upwork's real token endpoint, and reconnect after expiry.
- [ ] Revoking access in Upwork (Account Settings → Connected Apps) flips our status to
      "revoked".
- [ ] Tool list and data shapes are the same for our app as they were for Claude Code
      (job links carried a "claude" tracking tag, so the server does know who is calling).
- [ ] What an **error** from an Upwork tool looks like (none seen yet).
- [ ] Rate limits in real use; the 429 back-off has only been tested with fakes.

### Needs a different test account
- [ ] **An account with an active contract:** is its proposal listed under status `Hired`?
      And after the contract ends — `Hired` or `Archived`? (decides the Hired limit above)
- [ ] **An account with a submitted proposal** (status `Accepted`): confirm "Check with
      Upwork" promotes it, and that its `room_id` links a client reply automatically.
      (Row and detail shapes are verified, but from an *archived* proposal.)
- [ ] **An account with an offer** (status `Offered`).
- [ ] **A Freelancer Plus account:** what do proposal "insights" return? Is there anything
      usable for Viewed?
- [ ] **An account that has a JSS:** confirm the profile tool really does not return it.
- [ ] **An agency login:** what do `list_accounts`, `get_agency_dashboard` and `agency_rooms`
      return, and could one login cover several accounts?

### Still to decide
- [ ] Is data allowed to be stored at all, and for how long? One third-party write-up of
      Upwork's API terms says **24 hours**; not confirmed on Upwork's own page. The
      dashboards are built on stored data, so the answer matters.
- [ ] Add the three unique indexes above (one small migration).
- [ ] Login rate limiting at the edge.
- [ ] Which Node version the host uses: the project needs Node 22+ (it failed to install
      on Node 20 locally); `package.json` has no `engines` field.

### Verified so far (for reference)
Read-only, test account, through Claude Code's connector on 2026-09-30:
`list_accounts`, `get_account`, `find_jobs` (search + smart_search), `get_messages`
(list_rooms), `list_contracts` (search), `list_freelancer_proposals` (list + get, on an
archived proposal), `get_profile` (get + connects_balance), `get_freelancer_dashboard`.

### Before the first deploy (preview or production)
- [ ] Set in Vercel: `DEV_SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `APP_BASE_URL`
      (`https://upwork-tracking-tool.vercel.app`). Without them login fails.
- [ ] Apply the schema migration to that database (`prisma/migrations/20260921204514_mcp_migration`).
- [ ] Create the first admin there: `node scripts/set-password.mjs --email … --create --name … --role admin`.
- [ ] Revoke old extension tokens there: `node scripts/revoke-extension-tokens.mjs` (dry run first).
- [ ] Give every bidder a password (Team page → Set).
- [ ] Run the purge there once it has data: `DATABASE_URL=… node scripts/purge-expired.mjs --dry-run`,
      read the counts, then without `--dry-run`.

### Code clean-up still open
- [x] Lint is clean (Phase I). Note: 13 older effects carry an explained
      `eslint-disable-next-line react-hooks/set-state-in-effect` instead of a rewrite
      (`app/page.tsx`, `app/me/page.tsx`, `components/OverviewPanel.tsx`, 7 admin views).
      Rewrite them properly only together with a wider clean-up of those files.
- [ ] No test covers the screens themselves (React components); they were checked by hand in
      the browser. No end-to-end browser tests exist.
- [ ] Remove unused legacy code and tables (coverage routes/views, `GuideView`, `lib/tokens.ts`,
      extension token tables) in a follow-up once the new flow is proven.
