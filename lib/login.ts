import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { burnPasswordCheck, verifyPassword } from "@/lib/crypto";

export const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// Email + password check for a member of the given role. Returns null on any failure
// (unknown email, wrong role, inactive, no password set, wrong password) so callers
// can't leak which one it was.
export async function authenticateMember(
  email: string,
  password: string,
  role: "admin" | "bidder",
) {
  const member = await prisma.teamMember.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    omit: { passwordHash: false },
  });

  if (!member || !member.passwordHash) {
    burnPasswordCheck(password);
    return null;
  }
  const ok = verifyPassword(password, member.passwordHash);
  if (!ok || member.role !== role || member.status !== "active") return null;

  await prisma.teamMember.update({
    where: { id: member.id },
    data: { lastLoginAt: new Date() },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...safe } = member;
  return safe;
}
