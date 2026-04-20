(function () {
  const isFreelancerId = (id) => /^~?01[a-f0-9]{14,}$/i.test(String(id || ""));
  const clean = (id) => String(id).replace(/^~/, "");

  function detectAccount() {
    try {
      const state = window.__INITIAL_STATE__;
      const sid = state?.user?.ciphertext || state?.user?.id;
      if (sid && isFreelancerId(sid)) {
        return { userId: clean(sid), name: state.user.name || null, username: state.user.username || null };
      }
    } catch (_) {}
    try {
      const link = document.querySelector('a[href*="/freelancers/~"]');
      if (link) {
        const m = link.href.match(/\/freelancers\/~(\w+)/);
        if (m && isFreelancerId(m[1])) return { userId: clean(m[1]), name: null, username: null };
      }
    } catch (_) {}
    try {
      const meta = document.querySelector('meta[name="user-id"]');
      if (meta?.content && isFreelancerId(meta.content)) return { userId: clean(meta.content), name: null, username: null };
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
