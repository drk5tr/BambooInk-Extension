// Runs at document_start in the ISOLATED world.
// Injects the main-world hook as an external script (bypasses CSP).

const script = document.createElement("script");
script.src = chrome.runtime.getURL("shadow-hook-main.js");
(document.documentElement || document.head || document.body).appendChild(script);

export {};
