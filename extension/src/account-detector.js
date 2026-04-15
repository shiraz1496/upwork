(function () {
  function detectAccount() {
    try {
      const state = window.__INITIAL_STATE__;
      if (state?.user?.id) {
        return { userId: String(state.user.id), name: state.user.name || null, username: state.user.username || null };
      }
    } catch (_) {}
    try {
      const meta = document.querySelector('meta[name="user-id"]');
      if (meta?.content) return { userId: meta.content, name: null, username: null };
    } catch (_) {}
    return null;
  }
  function tryDetect(attempts) {
    const account = detectAccount();
    if (account) {
      window.postMessage({ type: "UPWORK_ACCOUNT_DETECTED", payload: account }, window.location.origin);
      return;
    }
    if (attempts > 0) setTimeout(() => tryDetect(attempts - 1), 300);
  }
  tryDetect(10);
})();
