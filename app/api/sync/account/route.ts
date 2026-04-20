import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { freelancerId, name, jss, connectsBalance } = body;

    if (!freelancerId) {
      return NextResponse.json({ error: "freelancerId required" }, { status: 400 });
    }

    // Only treat as a real name if it's not just a numeric/hex ID
    const isRealName = name && !/^\w{10,}$/.test(name) && /[a-zA-Z].*\s/.test(name) || (name && name.length < 30 && /[A-Z]/.test(name) && !/^\d+$/.test(name));

    const account = await prisma.account.upsert({
      where: { freelancerId: String(freelancerId) },
      update: {
        ...(isRealName ? { name } : {}),
        ...(jss !== null && jss !== undefined ? { jss: Number(jss) } : {}),
        ...(connectsBalance !== null && connectsBalance !== undefined ? { connectsBalance: Number(connectsBalance) } : {}),
      },
      create: {
        freelancerId: String(freelancerId),
        name: isRealName ? name : String(freelancerId),
        jss: jss ?? null,
        connectsBalance: connectsBalance ?? null,
      },
    });

    return NextResponse.json({ ok: true, accountId: account.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/account]", message);
    return NextResponse.json({ error: "Failed to sync account" }, { status: 500 });
  }
}
