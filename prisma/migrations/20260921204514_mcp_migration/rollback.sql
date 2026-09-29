-- DropForeignKey
ALTER TABLE "UpworkConnection" DROP CONSTRAINT "UpworkConnection_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalDraft" DROP CONSTRAINT "ProposalDraft_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalDraft" DROP CONSTRAINT "ProposalDraft_accountId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalStatusEvent" DROP CONSTRAINT "ProposalStatusEvent_draftId_fkey";

-- DropForeignKey
ALTER TABLE "ProposalStatusEvent" DROP CONSTRAINT "ProposalStatusEvent_actorId_fkey";

-- DropForeignKey
ALTER TABLE "ClientResponse" DROP CONSTRAINT "ClientResponse_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ClientResponse" DROP CONSTRAINT "ClientResponse_draftId_fkey";

-- DropForeignKey
ALTER TABLE "JobReviewLog" DROP CONSTRAINT "JobReviewLog_memberId_fkey";

-- AlterTable
ALTER TABLE "TeamMember" DROP COLUMN "lastLoginAt",
DROP COLUMN "passwordHash",
DROP COLUMN "passwordSetAt",
DROP COLUMN "sessionVersion";

-- DropTable
DROP TABLE "UpworkConnection";

-- DropTable
DROP TABLE "ProposalDraft";

-- DropTable
DROP TABLE "ProposalStatusEvent";

-- DropTable
DROP TABLE "ClientResponse";

-- DropTable
DROP TABLE "JobReviewLog";

-- DropEnum
DROP TYPE "ConnectionStatus";

-- DropEnum
DROP TYPE "ProposalState";

-- DropEnum
DROP TYPE "Provenance";

