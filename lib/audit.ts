import { prisma } from "@/lib/prisma";

export type AuditInput = {
  event: string;
  actorId?: string | null;
  subjectType?: string;
  subjectId?: string;
  meta?: Record<string, unknown>;
};

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        event: input.event,
        actorId: input.actorId ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        meta: input.meta ? (input.meta as object) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] failed", input.event, err);
  }
}
