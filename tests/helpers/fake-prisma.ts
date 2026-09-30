// In-memory stand-in for the parts of the Prisma client the Upwork layer uses.
// Keeps tests off any real database.

type Row = Record<string, unknown>;

function applyData(row: Row, data: Row): Row {
  const out = { ...row };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Row)) {
      out[k] = ((out[k] as number) ?? 0) + ((v as { increment: number }).increment);
    } else {
      out[k] = v;
    }
  }
  out.updatedAt = new Date();
  return out;
}

// What real Prisma throws when an update/delete matches no row.
function notFound(): Error {
  return Object.assign(new Error("fake prisma: record to update/delete not found"), { code: "P2025" });
}

export function createFakePrisma() {
  const connections = new Map<string, Row>(); // by memberId
  const members = new Map<string, Row>(); // by id

  const upworkConnection = {
    findUnique: async ({ where }: { where: { memberId: string } }) => connections.get(where.memberId) ?? null,
    findFirst: async ({ where }: { where: { upworkAccountId: string; memberId: { not: string }; status: string } }) =>
      [...connections.values()].find(
        (c) => c.upworkAccountId === where.upworkAccountId && c.memberId !== where.memberId.not && c.status === where.status,
      ) ?? null,
    findMany: async ({ where }: { where: { status?: string; lastSyncedAt?: { not: null }; upworkAccountId?: { in?: string[]; not?: null } } }) =>
      [...connections.values()].filter(
        (c) =>
          (where.status === undefined || c.status === where.status) &&
          (where.lastSyncedAt === undefined || c.lastSyncedAt != null) &&
          (where.upworkAccountId?.in === undefined || where.upworkAccountId.in.includes(c.upworkAccountId as string)),
      ),
    upsert: async ({ where, create, update }: { where: { memberId: string }; create: Row; update: Row }) => {
      const existing = connections.get(where.memberId);
      const row = existing
        ? applyData(existing, update)
        : applyData(
            { id: `conn_${where.memberId}`, status: "disconnected", scopes: [], createdAt: new Date(), upworkAccountId: null, accountName: null, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, connectedAt: null, lastSyncedAt: null, lastError: null },
            create,
          );
      connections.set(where.memberId, row);
      return row;
    },
    update: async ({ where, data }: { where: { memberId: string }; data: Row }) => {
      const existing = connections.get(where.memberId);
      if (!existing) throw new Error("fake prisma: connection not found");
      const row = applyData(existing, data);
      connections.set(where.memberId, row);
      return row;
    },
  };

  // Mirrors the app's Prisma client: passwordHash is omitted unless a query opts back in
  // with `omit: { passwordHash: false }` (see lib/prisma.ts).
  const visible = (row: Row | undefined, omit?: { passwordHash?: boolean }) => {
    if (!row) return null;
    if (omit?.passwordHash === false) return { ...row };
    const { passwordHash: _hidden, ...rest } = row;
    void _hidden;
    return rest;
  };
  const teamMember = {
    findUnique: async ({ where, omit }: { where: { id: string }; omit?: { passwordHash?: boolean } }) =>
      visible(members.get(where.id), omit),
    findFirst: async ({ where, omit }: { where: { email: { equals: string } }; omit?: { passwordHash?: boolean } }) =>
      visible(
        [...members.values()].find((m) => String(m.email).toLowerCase() === where.email.equals.toLowerCase()),
        omit,
      ),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = applyData(members.get(where.id) ?? { id: where.id, sessionVersion: 0 }, data);
      members.set(where.id, row);
      return visible(row);
    },
    updateMany: async ({ where, data }: { where: { id: string; sessionVersion?: number }; data: Row }) => {
      const row = members.get(where.id);
      if (!row || (where.sessionVersion !== undefined && row.sessionVersion !== where.sessionVersion)) return { count: 0 };
      members.set(where.id, applyData(row, data));
      return { count: 1 };
    },
    count: async ({ where }: { where: { role?: string; status?: string; id?: { not: string } } }) =>
      [...members.values()].filter(
        (m) =>
          (where.role === undefined || m.role === where.role) &&
          (where.status === undefined || m.status === where.status) &&
          (where.id === undefined || m.id !== where.id.not),
      ).length,
  };

  // ---- proposal drafts ----
  const drafts = new Map<string, Row>(); // by id
  const accounts = new Set<string>();
  let seq = 0;
  const withEvents = (row: Row) => ({ ...row, statusEvents: [...(row._events as Row[])] });
  const addEvent = (row: Row, nested?: { create?: Row }) => {
    if (nested?.create) (row._events as Row[]).push({ id: `ev_${++seq}`, draftId: row.id, at: new Date(), note: null, ...nested.create });
  };

  const proposalDraft = {
    findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
      const row = drafts.get(where.id);
      return row ? (include ? withEvents(row) : { ...row }) : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = drafts.get(where.id);
      if (!row) throw new Error("fake prisma: draft not found");
      return withEvents(row);
    },
    findFirst: async ({ where }: { where: { memberId: string; upworkJobId: string; id?: { not: string } } }) =>
      [...drafts.values()].find(
        (d) => d.memberId === where.memberId && d.upworkJobId === where.upworkJobId && (!where.id || d.id !== where.id.not),
      ) ?? null,
    findMany: async ({ where }: { where: { memberId: string; state?: string | { in: string[] } } }) =>
      [...drafts.values()]
        .filter((d) => {
          if (d.memberId !== where.memberId) return false;
          if (!where.state) return true;
          return typeof where.state === "string" ? d.state === where.state : where.state.in.includes(d.state as string);
        })
        .map(withEvents),
    create: async ({ data }: { data: Row & { statusEvents?: { create?: Row } } }) => {
      const { statusEvents, ...rest } = data;
      const row: Row = {
        id: `draft_${++seq}`,
        state: "DRAFT",
        readyAt: null,
        submissionConfirmedAt: null,
        submittedCoverLetter: null,
        submittedBidAmount: null,
        submissionProvenance: null,
        jobDescriptionCache: null,
        jobDataExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _events: [],
        ...rest,
      };
      addEvent(row, statusEvents);
      drafts.set(row.id as string, row);
      return withEvents(row);
    },
    update: async ({ where, data }: { where: { id: string; state?: string }; data: Row & { statusEvents?: { create?: Row } } }) => {
      const existing = drafts.get(where.id);
      // Like real Prisma: extra fields in `where` are a precondition.
      if (!existing || (where.state !== undefined && existing.state !== where.state)) throw notFound();
      const { statusEvents, ...rest } = data;
      const row = applyData(existing, rest);
      addEvent(row, statusEvents);
      drafts.set(where.id, row);
      return withEvents(row);
    },
    delete: async ({ where }: { where: { id: string; state?: string } }) => {
      const existing = drafts.get(where.id);
      if (!existing || (where.state !== undefined && existing.state !== where.state)) throw notFound();
      drafts.delete(where.id);
    },
    updateMany: async ({ where, data }: { where: { accountId: string }; data: Row }) => {
      let count = 0;
      for (const [id, d] of drafts) {
        if (d.accountId !== where.accountId) continue;
        drafts.set(id, { ...d, ...data });
        count++;
      }
      return { count };
    },
  };

  // accountId → { keywords, skills } (admin configuration used by job review)
  const accountConfig = new Map<string, { keywords: string[]; skills: string[] }>();
  const accountRows = new Map<string, Row>(); // real Account rows, by id
  const account = {
    findUnique: async ({ where }: { where: { id?: string; freelancerId?: string } }) => {
      if (where.freelancerId !== undefined) {
        return [...accountRows.values()].find((a) => a.freelancerId === where.freelancerId) ?? null;
      }
      const id = where.id!;
      const row = accountRows.get(id);
      const cfg = accountConfig.get(id);
      if (!row && !accounts.has(id) && !cfg) return null;
      return {
        id,
        ...row,
        keywords: (cfg?.keywords ?? []).map((text) => ({ text })),
        profile: cfg ? { skills: cfg.skills } : null,
      };
    },
    create: async ({ data }: { data: Row }) => {
      if ([...accountRows.values()].some((a) => a.freelancerId === data.freelancerId)) {
        throw Object.assign(new Error("fake prisma: unique constraint (freelancerId)"), { code: "P2002" });
      }
      const row = { id: `acc_${++seq}`, connectsBalance: null, jss: null, ...data };
      accountRows.set(row.id, row);
      return row;
    },
    upsert: async ({ where, create }: { where: { freelancerId: string }; create: Row; update: Row }) => {
      const existing = [...accountRows.values()].find((a) => a.freelancerId === where.freelancerId);
      if (existing) return existing;
      const row = { id: `acc_${++seq}`, connectsBalance: null, jss: null, ...create };
      accountRows.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = { ...accountRows.get(where.id)!, ...data };
      accountRows.set(where.id, row);
      return row;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      accountRows.delete(where.id);
    },
  };

  const keywordMoves: { from: string; to: string }[] = [];
  const accountKeyword = {
    updateMany: async ({ where, data }: { where: { accountId: string }; data: { accountId: string } }) => {
      keywordMoves.push({ from: where.accountId, to: data.accountId });
      return { count: 0 };
    },
  };

  // Dashboard tables fed from the new pipeline.
  const proposals = new Map<string, Row>();
  const proposal = {
    findFirst: async ({ where }: { where: { accountId: string; jobUrl: string; capturedByUserId?: string } }) =>
      [...proposals.values()].find(
        (p) =>
          p.accountId === where.accountId &&
          p.jobUrl === where.jobUrl &&
          (where.capturedByUserId === undefined || p.capturedByUserId === where.capturedByUserId),
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { id: `prop_${++seq}`, viewedByClient: false, hiredAt: null, ...data };
      proposals.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = { ...proposals.get(where.id)!, ...data };
      proposals.set(where.id, row);
      return row;
    },
    updateMany: async ({ where, data }: { where: { accountId: string; jobUrl?: string; section?: string; capturedByUserId?: string }; data: Row }) => {
      let count = 0;
      for (const [id, p] of proposals) {
        if (p.accountId !== where.accountId) continue;
        if (where.capturedByUserId !== undefined && p.capturedByUserId !== where.capturedByUserId) continue;
        if (where.jobUrl !== undefined && p.jobUrl !== where.jobUrl) continue;
        if (where.section !== undefined && p.section !== where.section) continue;
        proposals.set(id, { ...p, ...data });
        count++;
      }
      return { count };
    },
  };

  const alerts = new Map<string, Row>();
  const alert = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `alert_${++seq}`, read: false, ...data };
      alerts.set(row.id, row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const [id, a] of alerts) {
        if (where.accountId !== undefined && a.accountId !== where.accountId) continue;
        if (where.capturedByUserId !== undefined && a.capturedByUserId !== where.capturedByUserId) continue;
        const room = where.roomId as { in: string[] } | undefined;
        if (room && !room.in.includes(a.roomId as string)) continue;
        if (where.freelancerReplied !== undefined && a.freelancerReplied !== where.freelancerReplied) continue;
        alerts.set(id, { ...a, ...data });
        count++;
      }
      return { count };
    },
  };

  const profiles = new Map<string, Row>(); // FreelancerProfile by accountId
  const freelancerProfile = {
    upsert: async ({ where, create, update }: { where: { accountId: string }; create: Row; update: Row }) => {
      const row = profiles.has(where.accountId) ? { ...profiles.get(where.accountId)!, ...update } : { ...create };
      profiles.set(where.accountId, row);
      return row;
    },
  };

  const criteria: Row[] = [];
  const biddingCriterion = { findMany: async () => criteria.filter((c) => c.active !== false) };
  const blockedTitles: string[] = [];
  const blockedTitle = { findMany: async () => blockedTitles.map((pattern) => ({ pattern })) };

  const reviewLogs: Row[] = [];
  const jobReviewLog = {
    findFirst: async ({ where }: { where: { memberId: string; upworkJobId: string; reviewedAt: { gte: Date } } }) =>
      reviewLogs.find(
        (l) => l.memberId === where.memberId && l.upworkJobId === where.upworkJobId && (l.reviewedAt as Date) >= where.reviewedAt.gte,
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { id: `rev_${++seq}`, reviewedAt: new Date(), ...data };
      reviewLogs.push(row);
      return row;
    },
  };

  const responses = new Map<string, Row>();
  const withDraft = (r: Row) => {
    const d = r.draftId ? drafts.get(r.draftId as string) : null;
    return { ...r, draft: d ? { id: d.id, jobTitle: d.jobTitle } : null };
  };
  const clientResponse = {
    findFirst: async ({ where }: { where: { memberId: string; upworkThreadId: string; upworkMessageId: string } }) =>
      [...responses.values()].find(
        (r) => r.memberId === where.memberId && r.upworkThreadId === where.upworkThreadId && r.upworkMessageId === where.upworkMessageId,
      ) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) => responses.get(where.id) ?? null,
    count: async ({ where }: { where: { draftId: string; kind: string } }) =>
      [...responses.values()].filter((r) => r.draftId === where.draftId && r.kind === where.kind).length,
    findMany: async ({ where }: { where: { memberId: string } }) =>
      [...responses.values()].filter((r) => r.memberId === where.memberId).map(withDraft),
    create: async ({ data }: { data: Row }) => {
      const row = { id: `resp_${++seq}`, createdAt: new Date(), ...data };
      responses.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = { ...responses.get(where.id)!, ...data };
      responses.set(where.id, row);
      return withDraft(row);
    },
  };

  return {
    proposalDraft,
    account,
    proposal,
    alert,
    freelancerProfile,
    accountKeyword,
    _keywordMoves: keywordMoves,
    _accountRows: accountRows,
    _proposals: proposals,
    _alerts: alerts,
    _profiles: profiles,
    biddingCriterion,
    blockedTitle,
    jobReviewLog,
    clientResponse,
    _drafts: drafts,
    _accounts: accounts,
    _accountConfig: accountConfig,
    _criteria: criteria,
    _blockedTitles: blockedTitles,
    _reviewLogs: reviewLogs,
    _responses: responses,
    upworkConnection,
    teamMember,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    _connections: connections,
    _members: members,
    _reset() {
      connections.clear();
      members.clear();
      drafts.clear();
      accounts.clear();
    },
  };
}
