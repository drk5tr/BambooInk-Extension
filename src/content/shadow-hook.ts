// Runs at document_start in the ISOLATED world.
// Injects a <script> into the page to run in the MAIN world,
// intercepting attachShadow before any page JS executes.

const code = `
  window.__bambooinkShadowRoots = [];
  const _origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const shadow = _origAttachShadow.call(this, Object.assign({}, init, { mode: 'open' }));
    window.__bambooinkShadowRoots.push(shadow);
    return shadow;
  };
`;

const script = document.createElement("script");
script.textContent = code;
(document.documentElement || document.head || document.body).appendChild(script);
script.remove(); // Clean up — the code has already executed

export {};
