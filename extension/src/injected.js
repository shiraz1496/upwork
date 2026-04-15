(function () {
  if (window.__upworkTrackerInjected) return;
  window.__upworkTrackerInjected = true;
  const GQL_URL = "https://www.upwork.com/api/graphql/v1";
  const METRICS_ALIAS = "gql-query-metrics";
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const isMetricsCall = url.includes(GQL_URL) && url.includes(METRICS_ALIAS);
      if (isMetricsCall) {
        const clone = response.clone();
        const body = typeof args[1]?.body === "string" ? args[1].body : null;
        clone.json().then((data) => {
          let variables = {};
          if (body) {
            try { variables = JSON.parse(body).variables || {}; } catch (_) {}
          }
          window.postMessage({
            type: "UPWORK_METRICS_CAPTURED",
            payload: { data, variables, capturedAt: new Date().toISOString() }
          }, window.location.origin);
        });
      }
    } catch (_) {}
    return response;
  };
})();
