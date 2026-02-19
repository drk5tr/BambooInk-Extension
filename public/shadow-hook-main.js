// Runs in the page's MAIN world. Intercepts attachShadow to force open mode.
window.__bambooinkShadowRoots = [];
var _origAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(init) {
  var shadow = _origAttachShadow.call(this, Object.assign({}, init, { mode: 'open' }));
  window.__bambooinkShadowRoots.push(shadow);
  return shadow;
};
