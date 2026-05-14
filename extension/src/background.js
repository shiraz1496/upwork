const DEFAULT_BACKEND_URL = "http://localhost:3000";

console.log("[UT BG] Service worker started v5");

// ── Global crash guards ────────────────────────────────────────────────
// Without these, a single unhandled error or rejection terminates the
// service worker and Chrome may refuse to restart it for the session.
self.addEventListener("error", (ev) => {
  console.error("[UT BG] uncaught error:", ev?.message, ev?.error);
  ev.preventDefault?.();
});
self.addEventListener("unhandledrejection", (ev) => {
  console.error("[UT BG] unhandled rejection:", ev?.reason);
  ev.preventDefault?.();
});

function safeAsync(fn, name) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(`[UT BG] ${name || fn.name || "handler"} threw:`, e);
      return { ok: false, error: e?.message || String(e) };
    }
  };
}

// ── Inject fetch interceptor EARLY ──
// Chrome supports world:"MAIN". Firefox doesn't — content script handles fallback.
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ["src/injected.js"],
      world: "MAIN",
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["src/injected.js"],
      }).catch(() => {});
    });
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ["src/account-detector.js"],
      world: "MAIN",
    }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["src/account-detector.js"],
      }).catch(() => {});
    });
  },
  { url: [{ hostContains: "upwork.com" }] }
);

chrome.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    schedulePollOnUpworkNav();
    Promise.resolve()
      .then(() => checkUrlAgainstRequiredPages(details.url))
      .catch((e) => console.warn("[UT BG] requiredPages check failed:", e))
      .finally(() =>
        checkCoverageAndNotify(details.tabId).catch((e) =>
          console.warn("[UT BG] coverage check failed:", e),
        ),
      );
  },
  { url: [{ hostContains: "upwork.com" }] }
);

// ── Get the ONE canonical freelancerId — always from storage ──
async function getFreelancerId() {
  const data = await chrome.storage.local.get(["canonicalUserId", "lastAccountInfo"]);
  return data.canonicalUserId || data.lastAccountInfo?.userId || null;
}

// ── Get the CURRENTLY BROWSED account's freelancerId (for coverage tracking) ──
// Unlike getFreelancerId(), this always reflects the active Upwork account,
// even when canonicalUserId is locked to a different (bidder's own) account.
async function getCurrentAccountId() {
  const data = await chrome.storage.local.get(["detectedAccountId", "canonicalUserId", "lastAccountInfo"]);
  return data.detectedAccountId || data.canonicalUserId || data.lastAccountInfo?.userId || null;
}

async function getAccountName() {
  const data = await chrome.storage.local.get(["lastAccountInfo"]);
  return data.lastAccountInfo?.name || null;
}

async function getBackendUrl() {
  const data = await chrome.storage.local.get(["backendUrl"]);
  return data.backendUrl || DEFAULT_BACKEND_URL;
}

function backendHeaders(token, backendUrl, extra = {}) {
  const headers = { ...extra };
  if (backendUrl.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function getAuthToken() {
  const { authToken } = await chrome.storage.local.get(["authToken"]);
  return authToken || null;
}

async function syncToBackend(endpoint, payload) {
  const backendUrl = await getBackendUrl();
  const token = await getAuthToken();
  if (!token) {
    console.warn("[UT BG] No auth token — skipping sync to", endpoint);
    await chrome.storage.local.set({ authError: "No token — paste in popup" });
    return { ok: false, error: "no token" };
  }

  const url = `${backendUrl}${endpoint}`;
  console.log("[UT BG] POST", url, JSON.stringify(payload).slice(0, 200));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: backendHeaders(token, backendUrl, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      console.error("[UT BG] 401 — token invalid/revoked, clearing");
      await chrome.storage.local.set({
        authToken: null,
        authMember: null,
        authError: "Token invalid or revoked. Paste a new one.",
      });
      return { ok: false, error: "unauthorized" };
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Server ${res.status}: ${text.slice(0, 120)}`);
    }

    const result = await res.json();
    console.log("[UT BG] Server:", JSON.stringify(result));
    const { syncCount = 0 } = await chrome.storage.local.get(["syncCount"]);
    await chrome.storage.local.set({
      lastSync: new Date().toISOString(),
      syncCount: syncCount + 1,
      authError: null,
    });
    return { ok: true, result };
  } catch (err) {
    console.error("[UT BG] FAILED:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Alarms for periodic alert checking ──
// Only create alarms that don't already exist — otherwise re-running this
// file (every SW wake-up) resets the timer and the alarm never fires.
async function ensureAlarm(name, opts) {
  const existing = await chrome.alarms.get(name);
  if (!existing) chrome.alarms.create(name, opts);
}
ensureAlarm("check-alerts", { periodInMinutes: 2 });
ensureAlarm("reply-reminder", { periodInMinutes: 3 });
ensureAlarm("refresh-required-pages", { periodInMinutes: 30 });
ensureAlarm("nudge-poll", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "check-alerts") checkForAlerts();
  if (alarm.name === "reply-reminder") checkUnrepliedMessages();
  if (alarm.name === "refresh-required-pages") fetchRequiredPages();
  if (alarm.name === "nudge-poll") pollPendingNudges().catch((e) => console.warn("[UT BG] nudge poll failed:", e));
});

// Run an immediate poll on service-worker startup so the toast can show
// without waiting up to a minute for the first alarm tick.
pollPendingNudges().catch((e) => console.warn("[UT BG] startup nudge poll failed:", e));

// Debounced poll triggered when the user opens any Upwork page.
let nudgePollDebounceTimer = null;
function schedulePollOnUpworkNav() {
  if (nudgePollDebounceTimer) return;
  nudgePollDebounceTimer = setTimeout(() => {
    nudgePollDebounceTimer = null;
    pollPendingNudges().catch((e) => console.warn("[UT BG] nav nudge poll failed:", e));
  }, 1500);
}

async function pollPendingNudges() {
  const token = await getAuthToken();
  if (!token) return;
  const backendUrl = await getBackendUrl();

  const res = await fetch(`${backendUrl}/api/nudges/pending`, {
    headers: backendHeaders(token, backendUrl),
  });
  if (!res.ok) return;
  const data = await res.json();
  if (!data?.count) return;

  const tabs = await chrome.tabs.query({ url: "*://*.upwork.com/*" });
  if (tabs.length === 0) return;
  const target = tabs.find((t) => t.active) || tabs[0];

  // Send one toast per account so the bidder sees each account's count separately
  for (const entry of (data.byAccount ?? [])) {
    chrome.tabs
      .sendMessage(target.id, {
        type: "SHOW_NUDGE_SUMMARY",
        payload: { count: entry.count, single: entry.single, accountName: entry.accountName },
      })
      .catch(() => {});
  }
}

async function ackAllNudges() {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: "no token" };
  const backendUrl = await getBackendUrl();
  const res = await fetch(`${backendUrl}/api/nudges/ack-all`, {
    method: "POST",
    headers: backendHeaders(token, backendUrl, { "Content-Type": "application/json" }),
  });
  return { ok: res.ok };
}

async function checkForAlerts() {
  // Only check stored unreplied messages, don't open any tabs
  await chrome.storage.local.set({ lastAlertCheck: Date.now() });
}

async function checkUnrepliedMessages() {
  const data = await chrome.storage.local.get(["unrepliedMessages"]);
  const unreplied = data.unrepliedMessages || [];

  for (const msg of unreplied) {
    const ageMs = Date.now() - (msg.detectedAt || 0);
    const ageMinutes = Math.round(ageMs / 60000);

    if (ageMs > 2 * 60 * 1000 && !msg.reminded) {
      // Send urgent reminder notification
      chrome.notifications.create(`reminder-${msg.senderName}-${Date.now()}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("src/icon128.png"),
        title: "URGENT: Unreplied Message",
        message: `You haven't replied to ${msg.senderName || "a client"}'s message (${ageMinutes} min ago)`,
      });

      msg.reminded = true;

    }
  }

  await chrome.storage.local.set({ unrepliedMessages: unreplied });
}

async function fetchBiddingCriteria() {
  const token = await getAuthToken();
  if (!token) return [];
  const backendUrl = await getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/bidding-criteria`, {
      headers: backendHeaders(token, backendUrl),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.criteria || [];
  } catch (e) {
    console.warn("[UT BG] fetchBiddingCriteria error", e);
    return [];
  }
}

async function fetchRequiredPages() {
  const token = await getAuthToken();
  if (!token) return;
  const backendUrl = await getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/coverage/pages`, {
      headers: backendHeaders(token, backendUrl),
    });
    if (!res.ok) return;
    const data = await res.json();
    const pages = data.pages || [];
    await chrome.storage.local.set({ requiredPages: pages });
    console.log("[UT BG] Loaded", pages.length, "required pages");
  } catch (e) {
    console.warn("[UT BG] fetchRequiredPages error", e);
  }
}

async function postPageVisit(pageId) {
  const token = await getAuthToken();
  if (!token) return;
  const backendUrl = await getBackendUrl();
  const freelancerId = await getCurrentAccountId();
  try {
    const res = await fetch(`${backendUrl}/api/coverage/visit`, {
      method: "POST",
      headers: backendHeaders(token, backendUrl, { "Content-Type": "application/json" }),
      body: JSON.stringify({ pageId, ...(freelancerId ? { freelancerId } : {}) }),
    });
    if (!res.ok) {
      console.warn("[UT BG] postPageVisit failed:", res.status);
      return;
    }
    console.log("[UT BG] Recorded visit for page", pageId, "account:", freelancerId ?? "unknown");
  } catch (e) {
    console.warn("[UT BG] postPageVisit error", e);
  }
}

async function checkUrlAgainstRequiredPages(url) {
  const { requiredPages } = await chrome.storage.local.get(["requiredPages"]);
  if (!requiredPages || !requiredPages.length) return;
  for (const page of requiredPages) {
    try {
      const normalize = (u) => u.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
      if (normalize(url).includes(normalize(page.url))) {
        await postPageVisit(page.id);
        break;
      }
    } catch {}
  }
}

async function checkCoverageAndNotify(tabId) {
  const token = await getAuthToken();
  if (!token) return;
  const backendUrl = await getBackendUrl();
  const freelancerId = await getCurrentAccountId();
  try {
    const params = freelancerId ? `?freelancerId=${encodeURIComponent(freelancerId)}` : "";
    const res = await fetch(`${backendUrl}/api/me/coverage${params}`, {
      headers: backendHeaders(token, backendUrl),
    });
    if (!res.ok) return;
    const data = await res.json();
    const pct = data.coveragePct ?? 100;
    if (pct >= 80) return;

    // Send modal to the tab that triggered the check, or find any active Upwork tab
    let targetTab = tabId;
    if (!targetTab) {
      const tabs = await chrome.tabs.query({ url: "https://www.upwork.com/*" });
      targetTab = tabs[0]?.id;
    }
    if (!targetTab) return;

    chrome.tabs.sendMessage(targetTab, {
      type: "SHOW_COVERAGE_MODAL",
      payload: { pct, unvisited: data.unvisited || [] },
    }).catch(() => {});
    console.log("[UT BG] Coverage modal sent to tab", targetTab, pct + "%");
  } catch (e) {
    console.warn("[UT BG] checkCoverageAndNotify error", e);
  }
}

// ── Messages ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[UT BG] Msg:", message.type);
  handleMessage(message)
    .then(sendResponse)
    .catch((e) => {
      console.error("[UT BG] handleMessage rejected:", e);
      try { sendResponse({ ok: false, error: e?.message || String(e) }); } catch {}
    });
  return true; // async response
});

const handleMessage = safeAsync(async (message) => {
  switch (message.type) {
    case "SAVE_ACCOUNT_INFO":
      return handleAccountDetected(message.payload);
    case "GQL_CAPTURED":
      return handleGqlCapture(message.payload);
    case "SCRAPED_ACCOUNT":
      return handleScrapedAccount(message.payload);
    case "SCRAPED_STATS":
      return handleScrapedStats(message.payload);
    case "SCRAPED_STATS_RAW": {
      console.log("[UT BG] Raw stats:", message.payload.rawText?.slice(0, 500));
      await chrome.storage.local.set({ lastStatsRaw: message.payload.rawText?.slice(0, 2000) });
      return { ok: true };
    }
    case "SCRAPED_JOB":
      return handleScrapedJob(message.payload);
    case "SCRAPED_FEED":
      return handleScrapedFeed(message.payload);
    case "SCRAPED_PROPOSALS":
      return handleScrapedProposals(message.payload);
    case "SCRAPED_PROPOSAL_DETAIL":
      return handleScrapedProposalDetail(message.payload);
    case "SCRAPED_APPLY_SUBMIT":
      return handleScrapedApplySubmit(message.payload);
    case "SCRAPED_MESSAGES":
      return handleScrapedMessages(message.payload);
    case "ACK_ALL_NUDGES":
      return ackAllNudges();
    case "ANALYZE_COVER_LETTER":
      return handleAnalyzeCoverLetter(message.payload);
    case "INITIAL_STATE":
      return handleInitialState(message.payload);
    case "SET_TOKEN":
      return handleSetToken(message.payload);
    case "CLEAR_TOKEN":
      return handleClearToken();
    case "FORCE_SYNC":
      return handleForceSync();
    case "GET_BIDDING_CRITERIA": {
      const criteria = await fetchBiddingCriteria();
      return { criteria };
    }
    case "GET_STATUS": {
      const data = await chrome.storage.local.get([
        "lastSync", "lastAccountInfo", "syncCount", "backendUrl",
        "canonicalUserId", "authMember", "authError", "queuedCount",
      ]);
      return data;
    }
    default:
      return { ok: false };
  }
}, "handleMessage");

// ════════════════════════════════════════════════════
// ACCOUNT DETECTED (from account-detector.js)
// This is the CANONICAL userId source — runs on every Upwork page
// ════════════════════════════════════════════════════
async function handleAccountDetected(payload) {
  const { userId, name, username } = payload;
  console.log("[UT BG] Account detected — userId:", userId, "name:", name);

  if (!userId) return { ok: true, note: "no userId" };

  // Reject anything that isn't a freelancer ciphertext (e.g. numeric "162")
  if (!/^01[a-f0-9]{14,}$/i.test(String(userId))) {
    console.log("[UT BG] Rejecting non-freelancer ID:", userId);
    return { ok: true, note: "invalid id format" };
  }

  // Always track the currently browsed account for coverage page-visit tracking.
  // This is separate from canonicalUserId which is locked to the bidder's own account.
  await chrome.storage.local.set({ detectedAccountId: userId });
  console.log("[UT BG] detectedAccountId →", userId);

  // Don't overwrite canonical ID if already set with a different ID
  const existing = await chrome.storage.local.get(["canonicalUserId", "lastAccountInfo"]);
  if (existing.canonicalUserId && existing.canonicalUserId !== userId) {
    console.log("[UT BG] Skipping ID change:", existing.canonicalUserId, "→", userId);
    return { ok: true, note: "canonical ID already set" };
  }

  // Save as the canonical ID, merge with existing info
  const merged = { ...existing.lastAccountInfo, ...payload };
  await chrome.storage.local.set({
    canonicalUserId: userId,
    lastAccountInfo: merged,
  });

  // Only include name if we have a REAL name (not a userId fallback)
  const realName = name || username || existing.lastAccountInfo?.name || null;

  // Sync account to backend
  return syncToBackend("/api/sync/account", {
    freelancerId: userId,
    ...(realName ? { name: realName } : {}),
  });
}

// ════════════════════════════════════════════════════
// SCRAPED ACCOUNT (from profile page /freelancers/*)
// Merges profile data with the canonical account
// ════════════════════════════════════════════════════
async function handleScrapedAccount(payload) {
  const { userId, name, jss, connectsBalance } = payload;

  // ALWAYS use the canonical userId, not the profile URL ID
  const fid = await getFreelancerId();
  const accountName = name || await getAccountName();

  console.log("[UT BG] Profile scraped — using canonical fid:", fid, "name:", accountName, "jss:", jss, "connects:", connectsBalance);

  if (!fid) {
    // No canonical ID yet — save profile data for later
    const existing = await chrome.storage.local.get(["lastAccountInfo"]);
    await chrome.storage.local.set({ lastAccountInfo: { ...existing.lastAccountInfo, ...payload } });
    return { ok: false, note: "No canonical userId yet — visit any Upwork page first" };
  }

  if (userId && userId !== fid) {
    console.log("[UT BG] REJECTED: profile data from", userId, "does not match canonical", fid);
    return { ok: false, note: "Profile does not belong to logged-in user" };
  }

  // 1) Existing lightweight account upsert (name / jss / connects).
  const accountResult = await syncToBackend("/api/sync/account", {
    freelancerId: fid,
    name: accountName || fid,
    jss: jss ?? null,
    connectsBalance: connectsBalance ?? null,
  });

  // 2) Full profile sync (all rich fields — sent best-effort, ignore failure).
  try {
    await syncToBackend("/api/sync/freelancer-profile", {
      freelancerId: fid,
      name: accountName || null,
      title: payload.title ?? null,
      photoUrl: payload.photoUrl ?? null,
      location: payload.location ?? null,
      hourlyRate: payload.hourlyRate ?? null,
      totalEarnings: payload.totalEarnings ?? null,
      totalJobs: payload.totalJobs ?? null,
      totalHours: payload.totalHours ?? null,
      overview: payload.overview ?? null,
      skills: payload.skills ?? [],
      rawText: payload.rawText ?? null,
    });
  } catch (e) {
    console.warn("[UT BG] freelancer-profile sync failed:", e);
  }

  return accountResult;
}

// ════════════════════════════════════════════════════
// SCRAPED STATS (from /nx/my-stats)
// ════════════════════════════════════════════════════
async function handleScrapedStats(payload) {
  const { metrics, jss, connectsBalance, capturedAt, range } = payload;
  const fid = await getFreelancerId();
  const name = await getAccountName();

  if (!fid) return { ok: false, note: "No userId — visit any Upwork page first" };

  console.log("[UT BG] Stats → fid:", fid, "range:", range, "metrics:", JSON.stringify(metrics));

  return syncToBackend("/api/sync", {
    freelancerId: fid,
    accountName: name,
    capturedAt,
    range: range ?? null,
    jss: jss ?? null,
    connectsBalance: connectsBalance ?? null,
    totals: {
      proposals_sent_boosted: metrics.proposals_sent_boosted || 0,
      proposals_sent_organic: metrics.proposals_sent_organic || metrics.proposals_sent || 0,
      proposals_viewed_boosted: metrics.proposals_viewed_boosted || 0,
      proposals_viewed_organic: metrics.proposals_viewed_organic || metrics.proposals_viewed || 0,
      proposals_interviewed_boosted: metrics.proposals_interviewed_boosted || 0,
      proposals_interviewed_organic: metrics.proposals_interviewed_organic || metrics.proposals_interviewed || 0,
      proposals_hired_boosted: metrics.proposals_hired_boosted || 0,
      proposals_hired_organic: metrics.proposals_hired_organic || metrics.proposals_hired || 0,
    },
    series: [],
  });
}

// ════════════════════════════════════════════════════
// SCRAPED JOB (single job post or panel)
// ════════════════════════════════════════════════════
async function handleScrapedJob(payload) {
  console.log("[UT BG] Job:", payload.title);
  return { ok: true };
}

// ════════════════════════════════════════════════════
// SCRAPED FEED (multiple jobs from feed page)
// ════════════════════════════════════════════════════
async function handleScrapedFeed(payload) {
  const { jobs } = payload;
  console.log("[UT BG] Feed:", jobs?.length, "jobs (local only)");
  return { ok: true };
}

// ════════════════════════════════════════════════════
// SCRAPED PROPOSALS
// ════════════════════════════════════════════════════
async function handleScrapedProposals(payload) {
  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };
  return syncToBackend("/api/sync/proposals", { freelancerId: fid, ...payload });
}

async function handleScrapedProposalDetail(payload) {
  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };
  console.log("[UT BG] Proposal detail:", payload.title, "viewed:", payload.viewedByClient);
  return syncToBackend("/api/sync/proposal-detail", { freelancerId: fid, ...payload });
}

async function handleScrapedApplySubmit(payload) {
  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };
  console.log("[UT BG] Apply submit:", payload.title, "cover len:", payload.coverLetter?.length);
  return syncToBackend("/api/sync/proposal-detail", { freelancerId: fid, ...payload });
}

// ════════════════════════════════════════════════════
// GQL CAPTURED (GraphQL response intercepted)
// ════════════════════════════════════════════════════
async function handleGqlCapture(payload) {
  const { opName, data, variables, capturedAt } = payload;
  console.log("[UT BG] GQL:", opName, "keys:", Object.keys(data?.data || {}));

  const fid = await getFreelancerId();

  // Metrics
  const userMetrics = data?.data?.metrics?.userMetrics || data?.data?.userMetrics || [];
  if (userMetrics.length > 0 && fid) {
    console.log("[UT BG] GQL metrics!", userMetrics.length, "types");
    const totals = {};
    for (const m of userMetrics) {
      totals[m.metric] = m.data.reduce((sum, p) => sum + Number(p.value), 0);
    }
    return syncToBackend("/api/sync", {
      freelancerId: fid,
      accountName: await getAccountName(),
      capturedAt,
      startTimestamp: variables?.startTimestamp,
      endTimestamp: variables?.endTimestamp,
      totals: {
        proposals_sent_boosted: totals["PROPOSALS_SENT_BOOSTED"] || 0,
        proposals_sent_organic: totals["PROPOSALS_SENT_ORGANIC"] || 0,
        proposals_viewed_boosted: totals["PROPOSALS_VIEWED_BOOSTED"] || 0,
        proposals_viewed_organic: totals["PROPOSALS_VIEWED_ORGANIC"] || 0,
        proposals_interviewed_boosted: totals["PROPOSALS_INTERVIEWED_BOOSTED"] || 0,
        proposals_interviewed_organic: totals["PROPOSALS_INTERVIEWED_ORGANIC"] || 0,
        proposals_hired_boosted: totals["PROPOSALS_HIRED_BOOSTED"] || 0,
        proposals_hired_organic: totals["PROPOSALS_HIRED_ORGANIC"] || 0,
      },
      series: userMetrics,
    });
  }

  // User/identity in GQL response — update canonical ID
  const user = data?.data?.user || data?.data?.freelancer || data?.data?.identity || data?.data?.visitor;
  if (user && (user.id || user.uid || user.nid)) {
    const uid = String(user.id || user.uid || user.nid);
    const name = user.name || (user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : null);
    await chrome.storage.local.set({
      canonicalUserId: uid,
      lastAccountInfo: { userId: uid, name, ...(await chrome.storage.local.get(["lastAccountInfo"])).lastAccountInfo },
    });
    return syncToBackend("/api/sync/account", {
      freelancerId: uid,
      name: name || uid,
      jss: user.jobSuccessScore ?? user.jss ?? null,
    });
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════
// INITIAL STATE (from __INITIAL_STATE__)
// ════════════════════════════════════════════════════
async function handleInitialState(payload) {
  const { state } = payload;
  if (state?.user) {
    const uid = String(state.user.id || state.user.uid || "");
    if (uid) {
      const name = state.user.name || state.user.personName || null;
      await chrome.storage.local.set({
        canonicalUserId: uid,
        lastAccountInfo: { userId: uid, name },
      });
      return syncToBackend("/api/sync/account", { freelancerId: uid, name: name || uid });
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════
// SCRAPED MESSAGES (from messages page)
// ════════════════════════════════════════════════════
async function handleScrapedMessages(payload) {
  const { needAttention = [], nowReplied = [] } = payload;

  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };

  // Compare needAttention with previously stored to find NEW unreplied messages
  const stored = await chrome.storage.local.get(["lastNeedAttention", "unrepliedMessages"]);
  const prevKeys = new Set((stored.lastNeedAttention || []).map((m) => `${m.senderName}:${m.preview || ""}`));

  const brandNew = needAttention.filter(
    (m) => !prevKeys.has(`${m.senderName}:${m.preview || ""}`)
  );

  // Send browser notification only for brand new unreplied messages
  for (const msg of brandNew) {
    chrome.notifications.create(`msg-${msg.senderName}-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("src/icon128.png"),
      title: "New Upwork Message",
      message: `${msg.senderName || "Someone"}: ${msg.preview || "New message"}`,
    });
  }

  // Track unreplied messages for reminder system
  const unreplied = stored.unrepliedMessages || [];
  for (const msg of brandNew) {
    unreplied.push({
      senderName: msg.senderName,
      preview: msg.preview,
      url: msg.url,
      detectedAt: Date.now(),
      reminded: false,
    });
  }

  // Remove from unreplied list if now replied
  const repliedNames = new Set(nowReplied.map((m) => m.senderName));
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const activeUnreplied = unreplied.filter(
    (m) => m.detectedAt > oneDayAgo && !repliedNames.has(m.senderName)
  );

  await chrome.storage.local.set({
    lastNeedAttention: needAttention,
    unrepliedMessages: activeUnreplied,
  });

  // Sync to backend: only needAttention as new alerts
  const alerts = needAttention.map((m) => ({
    ...m,
    type: "message",
    title: m.title || `Message from ${m.senderName}`,
    needsAttention: true,
    freelancerReplied: false,
  }));

  // Also send nowReplied so backend can update their status
  const repliedAlerts = nowReplied.map((m) => ({
    ...m,
    type: "message",
    title: m.title || `Message from ${m.senderName}`,
    needsAttention: false,
    freelancerReplied: true,
  }));

  return syncToBackend("/api/sync/alert", {
    freelancerId: fid,
    alerts: [...alerts, ...repliedAlerts],
  });
}

// ════════════════════════════════════════════════════
// ANALYZE COVER LETTER (proxy to Gemini via /api/analyze/cover-letter)
// ════════════════════════════════════════════════════
async function handleAnalyzeCoverLetter(payload) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}/api/analyze/cover-letter`;
  console.log("[UT BG] Analyze cover letter →", url);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return { ok: false, error: `Backend returned non-JSON (${res.status})`, raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, error: result.error || `HTTP ${res.status}`, detail: result.detail };
    }
    return { ok: true, analysis: result.analysis };
  } catch (err) {
    console.error("[UT BG] Analyze failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════
// TOKEN + AUTH (extension ↔ backend)
// ════════════════════════════════════════════════════
async function handleSetToken({ raw }) {
  const backendUrl = await getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/api/auth/verify`, {
      method: "POST",
      headers: backendHeaders(raw, backendUrl, { "Content-Type": "application/json" }),
      body: "{}",
    });
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || "Token rejected" };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const { member } = await res.json();
    await chrome.storage.local.set({ authToken: raw, authMember: member, authError: null });
    fetchRequiredPages();
    return { ok: true, member };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleClearToken() {
  await chrome.storage.local.remove(["authToken", "authMember", "authError"]);
  return { ok: true };
}

async function handleForceSync() {
  const { lastAccountInfo: info } = await chrome.storage.local.get(["lastAccountInfo"]);
  fetchRequiredPages();
  if (!info?.userId) return { ok: false, error: "No account info yet — open any Upwork page" };
  return syncToBackend("/api/sync/account", {
    freelancerId: info.userId,
    ...(info.name ? { name: info.name } : {}),
  });
}

fetchRequiredPages();
