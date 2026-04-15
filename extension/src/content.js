const script = document.createElement("script");
script.src = chrome.runtime.getURL("src/injected.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

const detectorScript = document.createElement("script");
detectorScript.src = chrome.runtime.getURL("src/account-detector.js");
detectorScript.onload = () => detectorScript.remove();
(document.head || document.documentElement).appendChild(detectorScript);

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "UPWORK_METRICS_CAPTURED") {
    chrome.runtime.sendMessage({ type: "SAVE_METRICS", payload: event.data.payload });
  }
  if (event.data?.type === "UPWORK_ACCOUNT_DETECTED") {
    chrome.runtime.sendMessage({ type: "SAVE_ACCOUNT_INFO", payload: event.data.payload });
  }
});
