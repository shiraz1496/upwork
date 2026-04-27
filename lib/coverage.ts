import type { CoverageEntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scoreCoverage } from "@/lib/coverage-priority";

export type UpsertReferenceInput = {
  memberId: string;
  accountId: string;
  entityType: CoverageEntityType;
  entityId: string;
  openUrl?: string | null;
  reasonTags: string[];
};

export async function upsertCoverageReference(input: UpsertReferenceInput) {
  const now = new Date();
  const priority = scoreCoverage({
    entityType: input.entityType,
    reasonTags: input.reasonTags,
    referencedAt: now,
  });
  await prisma.coverageItem.upsert({
    where: {
      memberId_accountId_entityType_entityId: {
        memberId: input.memberId,
        accountId: input.accountId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    update: {
      reasonTags: input.reasonTags,
      openUrl: input.openUrl ?? undefined,
      priority,
      referencedAt: now,
    },
    create: {
      memberId: input.memberId,
      accountId: input.accountId,
      entityType: input.entityType,
      entityId: input.entityId,
      openUrl: input.openUrl ?? null,
      reasonTags: input.reasonTags,
      priority,
    },
  });
}

export async function markCoverageCaptured(input: {
  memberId: string;
  accountId: string;
  entityType: CoverageEntityType;
  entityId: string;
}): Promise<{ matched: boolean; alreadyCaptured?: boolean }> {
  const existing = await prisma.coverageItem.findUnique({
    where: {
      memberId_accountId_entityType_entityId: {
        memberId: input.memberId,
        accountId: input.accountId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
  });
  if (!existing) return { matched: false };
  if (existing.capturedAt) return { matched: true, alreadyCaptured: true };
  await prisma.coverageItem.update({
    where: { id: existing.id },
    data: { capturedAt: new Date() },
  });
  return { matched: true };
}
