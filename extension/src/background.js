const BACKEND_URL = "http://localhost:3000";
const ACCOUNT_MAP = {
  // "1294883316899397632": "Junaid",
  // "XXXXXXXXXXXXXXXXXXXX": "Jahanzeb",
  // "XXXXXXXXXXXXXXXXXXXX": "Osama",
  // "XXXXXXXXXXXXXXXXXXXX": "Saman",
  // "XXXXXXXXXXXXXXXXXXXX": "Abdullah",
};
let pendingAccountInfo = null;
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SAVE_ACCOUNT_INFO") {
    pendingAccountInfo = message.payload;
    chrome.storage.local.set({ lastAccountInfo: message.payload });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "SAVE_METRICS") {
    handleMetrics(message.payload).then((result) => sendResponse(result));
    return true;
  }
  if (message.type === "GET_STATUS") {
    chrome.storage.local.get(["lastSync", "lastAccountInfo", "syncCount"], (data) => sendResponse(data));
    return true;
  }
});
async function handleMetrics(payload) {
  const { data, variables, capturedAt } = payload;
  const freelancerId = String(variables?.freelancerId || "unknown");
  const accountName = ACCOUNT_MAP[freelancerId] || pendingAccountInfo?.name || null;
  const userMetrics = data?.data?.metrics?.userMetrics || [];
  const totals = {};
  for (const metric of userMetrics) {
    totals[metric.metric] = metric.data.reduce((sum, point) => sum + Number(point.value), 0);
  }
  const syncPayload = {
    freelancerId, accountName, capturedAt,
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
  };
  try {
    const res = await fetch(`${BACKEND_URL}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncPayload),
    });
    const result = await res.json();
    const syncCount = await new Promise(resolve => chrome.storage.local.get(["syncCount"], d => resolve(d.syncCount ?? 0)));
    await chrome.storage.local.set({ lastSync: capturedAt, lastFreelancerId: freelancerId, lastAccountName: accountName, syncCount: syncCount + 1 });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
