document.addEventListener("DOMContentLoaded", () => {
  const accountEl = document.getElementById("account");
  const lastSyncEl = document.getElementById("lastSync");
  const syncCountEl = document.getElementById("syncCount");
  const statusEl = document.getElementById("status");

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (data) => {
    if (!data) return;

    if (data.lastAccountInfo?.name) {
      accountEl.textContent = data.lastAccountInfo.name;
    } else if (data.lastAccountInfo?.userId) {
      accountEl.textContent = `ID: ${data.lastAccountInfo.userId}`;
    }

    if (data.lastSync) {
      const d = new Date(data.lastSync);
      lastSyncEl.textContent = d.toLocaleString();
      lastSyncEl.classList.add("success");
    }

    syncCountEl.textContent = data.syncCount ?? 0;
    statusEl.textContent = data.lastSync ? "Active" : "Waiting";
    statusEl.classList.add(data.lastSync ? "success" : "warning");
  });
});
