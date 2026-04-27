const els = {
  unauth: document.getElementById("unauth"),
  authed: document.getElementById("authed"),
  tokenInput: document.getElementById("tokenInput"),
  saveTokenBtn: document.getElementById("saveTokenBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
  memberName: document.getElementById("memberName"),
  memberEmail: document.getElementById("memberEmail"),
  authError: document.getElementById("authError"),
  account: document.getElementById("account"),
  lastSync: document.getElementById("lastSync"),
  syncCount: document.getElementById("syncCount"),
  queuedCount: document.getElementById("queuedCount"),
  status: document.getElementById("status"),
  forceSyncBtn: document.getElementById("forceSyncBtn"),
};

function send(type, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));
}

async function refresh() {
  const data = await send("GET_STATUS");
  if (!data) return;

  const signedIn = !!data.authMember;
  els.authed.classList.toggle("hidden", !signedIn);
  els.unauth.classList.toggle("hidden", signedIn);
  els.forceSyncBtn.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    els.memberName.textContent = data.authMember.name;
    els.memberEmail.textContent = data.authMember.email;
  }

  els.account.textContent = data.lastAccountInfo?.name || data.lastAccountInfo?.userId || "--";
  els.lastSync.textContent = data.lastSync ? new Date(data.lastSync).toLocaleString() : "Never";
  els.lastSync.classList.toggle("success", !!data.lastSync);
  els.syncCount.textContent = data.syncCount ?? 0;
  els.queuedCount.textContent = data.queuedCount ?? 0;

  if (data.authError) {
    els.status.textContent = data.authError;
    els.status.className = "value error";
  } else if (signedIn && data.lastSync) {
    els.status.textContent = "Active";
    els.status.className = "value success";
  } else if (signedIn) {
    els.status.textContent = "Ready — open Upwork";
    els.status.className = "value warning";
  } else {
    els.status.textContent = "Sign in";
    els.status.className = "value warning";
  }
}

els.saveTokenBtn.addEventListener("click", async () => {
  const raw = els.tokenInput.value.trim();
  if (!raw) return;
  els.authError.textContent = "";
  els.saveTokenBtn.disabled = true;
  const res = await send("SET_TOKEN", { raw });
  els.saveTokenBtn.disabled = false;
  if (!res?.ok) {
    els.authError.textContent = res?.error || "Token rejected";
    return;
  }
  els.tokenInput.value = "";
  refresh();
});

els.signOutBtn.addEventListener("click", async () => {
  await send("CLEAR_TOKEN");
  refresh();
});

els.forceSyncBtn.addEventListener("click", async () => {
  els.forceSyncBtn.disabled = true;
  const prev = els.forceSyncBtn.textContent;
  els.forceSyncBtn.textContent = "Syncing…";
  await send("FORCE_SYNC");
  els.forceSyncBtn.disabled = false;
  els.forceSyncBtn.textContent = prev;
  refresh();
});

refresh();
