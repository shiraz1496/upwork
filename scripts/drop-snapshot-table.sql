-- ============================================================================
-- Drop the Snapshot table (manual cleanup)
-- ============================================================================
--
-- Run this AFTER deploying the code change that removes the Snapshot model
-- from prisma/schema.prisma. The app code no longer reads or writes Snapshot,
-- so dropping the table is safe at any time after deploy.
--
-- This permanently deletes all historical snapshot rows. There is no recovery
-- without a backup — take one first if you want to retain the history offline.
--
-- Run against your Postgres database, e.g.:
--   psql "$DATABASE_URL" -f scripts/drop-snapshot-table.sql
--
-- ============================================================================

BEGIN;

-- The Snapshot.capturedByUserId FK → TeamMember(id) and Snapshot.accountId FK
-- → Account(id) are dropped automatically by DROP TABLE.
-- Indexes Snapshot_accountId_capturedAt_idx and Snapshot_capturedByUserId_idx
-- are also removed with the table.

DROP TABLE IF EXISTS "Snapshot";

COMMIT;
