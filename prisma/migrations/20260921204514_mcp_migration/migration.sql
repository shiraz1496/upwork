-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('disconnected', 'connected', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('DRAFT', 'READY', 'SUBMISSION_UNVERIFIED', 'SUBMITTED_CONFIRMED');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('MCP_VERIFIED', 'APP_RECORDED', 'DEVELOPER_CONFIRMED');

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "passwordSetAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UpworkConnection" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'disconnected',
    "upworkAccountId" TEXT,
    "accountName" TEXT,
    "scopes" TEXT[],
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "oauthState" TEXT,
    "oauthCodeVerifier" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpworkConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalDraft" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accountId" TEXT,
    "upworkJobId" TEXT NOT NULL,
    "jobUrl" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobDescriptionCache" TEXT,
    "jobDataProvenance" "Provenance" NOT NULL DEFAULT 'MCP_VERIFIED',
    "jobDataExpiresAt" TIMESTAMP(3),
    "coverLetter" TEXT NOT NULL,
    "bidType" TEXT NOT NULL DEFAULT 'hourly',
    "proposedRate" TEXT,
    "fixedBidAmount" TEXT,
    "state" "ProposalState" NOT NULL DEFAULT 'DRAFT',
    "readyAt" TIMESTAMP(3),
    "submissionConfirmedAt" TIMESTAMP(3),
    "submittedCoverLetter" TEXT,
    "submittedBidAmount" TEXT,
    "submissionProvenance" "Provenance",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalStatusEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromState" "ProposalState",
    "toState" "ProposalState" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientResponse" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "draftId" TEXT,
    "upworkThreadId" TEXT,
    "upworkMessageId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3),
    "provenance" "Provenance" NOT NULL DEFAULT 'MCP_VERIFIED',
    "associationMethod" TEXT NOT NULL DEFAULT 'verified_identifier',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobReviewLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "upworkJobId" TEXT NOT NULL,
    "jobTitle" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "Provenance" NOT NULL DEFAULT 'APP_RECORDED',

    CONSTRAINT "JobReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpworkConnection_memberId_key" ON "UpworkConnection"("memberId");

-- CreateIndex
CREATE INDEX "UpworkConnection_status_idx" ON "UpworkConnection"("status");

-- CreateIndex
CREATE INDEX "ProposalDraft_memberId_state_idx" ON "ProposalDraft"("memberId", "state");

-- CreateIndex
CREATE INDEX "ProposalDraft_upworkJobId_idx" ON "ProposalDraft"("upworkJobId");

-- CreateIndex
CREATE INDEX "ProposalStatusEvent_draftId_idx" ON "ProposalStatusEvent"("draftId");

-- CreateIndex
CREATE INDEX "ClientResponse_memberId_idx" ON "ClientResponse"("memberId");

-- CreateIndex
CREATE INDEX "ClientResponse_draftId_idx" ON "ClientResponse"("draftId");

-- CreateIndex
CREATE INDEX "JobReviewLog_memberId_reviewedAt_idx" ON "JobReviewLog"("memberId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "UpworkConnection" ADD CONSTRAINT "UpworkConnection_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDraft" ADD CONSTRAINT "ProposalDraft_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDraft" ADD CONSTRAINT "ProposalDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalStatusEvent" ADD CONSTRAINT "ProposalStatusEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ProposalDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalStatusEvent" ADD CONSTRAINT "ProposalStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientResponse" ADD CONSTRAINT "ClientResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientResponse" ADD CONSTRAINT "ClientResponse_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ProposalDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReviewLog" ADD CONSTRAINT "JobReviewLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

