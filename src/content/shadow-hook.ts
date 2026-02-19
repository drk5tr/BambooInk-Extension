// This script MUST run at document_start (before any page JS)
// to intercept Shadow DOM creation in Salesforce LWC and other frameworks.

(window as any).__bambooinkShadowRoots = [];

const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
  // Force open mode so we can access shadow roots later
  const shadow = originalAttachShadow.call(this, { ...init, mode: "open" as const });
  (window as any).__bambooinkShadowRoots.push(shadow);
  return shadow;
};

export {};
