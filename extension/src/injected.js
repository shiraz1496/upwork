// This file is injected into the MAIN world via chrome.scripting.executeScript
// It patches fetch/XHR to capture GraphQL responses
(function () {
  if (window.__utIntercepted) return;
  window.__utIntercepted = true;

  console.log("[UT] Fetch interceptor active (MAIN world)");

  const GQL = "https://www.upwork.com/api/graphql/v1";
  const origFetch = window.fetch;

  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input?.url || "";
      if (url.includes(GQL)) {
        const opts = args[1] || {};
        const bodyStr = typeof opts.body === "string" ? opts.body : null;
        let opName = "";
        let variables = {};
        if (bodyStr) {
          try {
            const p = JSON.parse(bodyStr);
            opName = p.operationName || "";
            variables = p.variables || {};
          } catch (_) {}
        }
        console.log("[UT] GraphQL:", opName || url.slice(url.indexOf("?")));
        const clone = res.clone();
        clone.json().then((data) => {
          window.postMessage({
            type: "UT_GQL_RESPONSE",
            payload: { url, opName, data, variables, bodyStr, capturedAt: new Date().toISOString() },
          }, window.location.origin);
        }).catch(() => {});
      }
    } catch (_) {}
    return res;
  };

  // Also intercept XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...r) {
    this._utUrl = url;
    return origOpen.apply(this, [m, url, ...r]);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._utUrl && this._utUrl.includes(GQL)) {
      const reqBody = body;
      this.addEventListener("load", function () {
        try {
          const data = JSON.parse(this.responseText);
          let opName = "", variables = {};
          if (typeof reqBody === "string") {
            try { const p = JSON.parse(reqBody); opName = p.operationName || ""; variables = p.variables || {}; } catch (_) {}
          }
          window.postMessage({
            type: "UT_GQL_RESPONSE",
            payload: { url: this._utUrl, opName, data, variables, bodyStr: reqBody, capturedAt: new Date().toISOString() },
          }, window.location.origin);
        } catch (_) {}
      });
    }
    return origSend.apply(this, [body]);
  };

  // Also try to extract __INITIAL_STATE__
  try {
    const state = window.__INITIAL_STATE__;
    if (state && typeof state === "object") {
      window.postMessage({
        type: "UT_INITIAL_STATE",
        payload: JSON.stringify(state),
      }, window.location.origin);
    }
  } catch (_) {}

  console.log("[UT] Interception ready (fetch + XHR)");
})();
