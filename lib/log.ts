import { redact } from "@/lib/crypto";

// All server logging goes through here so tokens, passwords, cover letters and
// message bodies never reach the logs (handover Phase B).

function describe(err: unknown) {
  if (err instanceof Error) {
    // Prisma/validation errors can echo query arguments in `message`; keep it short.
    return { name: err.name, message: err.message.slice(0, 300) };
  }
  return redact(err);
}

export function logError(tag: string, err: unknown, extra?: Record<string, unknown>) {
  console.error(`[${tag}]`, describe(err), ...(extra ? [redact(extra)] : []));
}

export function logInfo(tag: string, msg: string, extra?: Record<string, unknown>) {
  console.log(`[${tag}]`, msg, ...(extra ? [redact(extra)] : []));
}
