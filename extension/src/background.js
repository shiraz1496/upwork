const DEFAULT_BACKEND_URL = "https://upwork-tracking-tool.vercel.app";

console.log("[UT BG] Service worker started v5");

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

// ── Get the ONE canonical freelancerId — always from storage ──
async function getFreelancerId() {
  const data = await chrome.storage.local.get(["canonicalUserId", "lastAccountInfo"]);
  return data.canonicalUserId || data.lastAccountInfo?.userId || null;
}

async function getAccountName() {
  const data = await chrome.storage.local.get(["lastAccountInfo"]);
  return data.lastAccountInfo?.name || null;
}

async function getBackendUrl() {
  const data = await chrome.storage.local.get(["backendUrl"]);
  return data.backendUrl || DEFAULT_BACKEND_URL;
}

async function syncToBackend(endpoint, payload) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  console.log("[UT BG] POST", url, JSON.stringify(payload).slice(0, 200));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    console.log("[UT BG] Server:", JSON.stringify(result));
    const { syncCount = 0 } = await chrome.storage.local.get(["syncCount"]);
    await chrome.storage.local.set({ lastSync: new Date().toISOString(), syncCount: syncCount + 1 });
    return { ok: true, result };
  } catch (err) {
    console.error("[UT BG] FAILED:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Alarms for periodic alert checking ──
chrome.alarms.create("check-alerts", { periodInMinutes: 2 });
chrome.alarms.create("reply-reminder", { periodInMinutes: 3 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "check-alerts") checkForAlerts();
  if (alarm.name === "reply-reminder") checkUnrepliedMessages();
});

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

        title: "URGENT: Unreplied Message",
        message: `You haven't replied to ${msg.senderName || "a client"}'s message (${ageMinutes} min ago)`,
      });

      msg.reminded = true;

    }
  }

  await chrome.storage.local.set({ unrepliedMessages: unreplied });
}

// ── Messages ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[UT BG] Msg:", message.type);
  handleMessage(message).then(sendResponse);
  return true; // async response
});

async function handleMessage(message) {
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
    case "SCRAPED_MESSAGES":
      return handleScrapedMessages(message.payload);
    case "ANALYZE_COVER_LETTER":
      return handleAnalyzeCoverLetter(message.payload);
    case "INITIAL_STATE":
      return handleInitialState(message.payload);
    case "GET_STATUS": {
      const data = await chrome.storage.local.get(
        ["lastSync", "lastAccountInfo", "syncCount", "backendUrl", "canonicalUserId"]
      );
      return data;
    }
    default:
      return { ok: false };
  }
}

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
  const { name, jss, connectsBalance } = payload;

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

  return syncToBackend("/api/sync/account", {
    freelancerId: fid,
    name: accountName || fid,
    jss: jss ?? null,
    connectsBalance: connectsBalance ?? null,
  });
}

// ════════════════════════════════════════════════════
// SCRAPED STATS (from /nx/my-stats)
// ════════════════════════════════════════════════════
async function handleScrapedStats(payload) {
  const { metrics, jss, connectsBalance, capturedAt } = payload;
  const fid = await getFreelancerId();
  const name = await getAccountName();

  if (!fid) return { ok: false, note: "No userId — visit any Upwork page first" };

  console.log("[UT BG] Stats → fid:", fid, "metrics:", JSON.stringify(metrics));

  return syncToBackend("/api/sync", {
    freelancerId: fid,
    accountName: name,
    capturedAt,
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
  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };
  console.log("[UT BG] Job:", payload.title);
  return syncToBackend("/api/sync/job", { freelancerId: fid, ...payload });
}

// ════════════════════════════════════════════════════
// SCRAPED FEED (multiple jobs from feed page)
// ════════════════════════════════════════════════════
async function handleScrapedFeed(payload) {
  const fid = await getFreelancerId();
  if (!fid) return { ok: false, note: "No userId" };

  const { jobs } = payload;
  console.log("[UT BG] Feed:", jobs?.length, "jobs");

  let synced = 0;
  for (const job of (jobs || [])) {
    if (!job.title || !job.url) continue;
    const result = await syncToBackend("/api/sync/job", { freelancerId: fid, ...job });
    if (result.ok) synced++;
  }

  console.log("[UT BG] Feed synced:", synced, "/", jobs?.length);
  return { ok: true, synced };
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
