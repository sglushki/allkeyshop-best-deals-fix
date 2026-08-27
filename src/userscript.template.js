// ==UserScript==
// @name         AllKeyShop Best Deals Fix
// @namespace    https://www.allkeyshop.com/
// @version      0.3.1
// @description  Compatibility shim for AllKeyShop's broken "Best deals" catalogue sort.
// @match        https://www.allkeyshop.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const PATCH_MARK = '__aksBestDealsFixPatched__';
  const nativeFetch = window.fetch;

  if (typeof nativeFetch !== 'function' || nativeFetch[PATCH_MARK]) {
    return;
  }

  /*__REWRITE_CATALOGUE_URL__*/

  function patchedFetch(input, init) {
    try {
      const inputUrl = input instanceof Request ? input.url : input;
      const rewrittenUrl = rewriteCatalogueUrl(inputUrl, location.href);

      if (!rewrittenUrl) {
        return Reflect.apply(nativeFetch, this, arguments);
      }

      const rewrittenInput =
        input instanceof Request
          ? new Request(rewrittenUrl, input)
          : rewrittenUrl;

      return nativeFetch.call(this, rewrittenInput, init);
    } catch {
      // A compatibility shim should fail open: if the rewrite itself ever
      // encounters an unexpected browser/API change, preserve site behavior.
      return Reflect.apply(nativeFetch, this, arguments);
    }
  }

  Object.defineProperty(patchedFetch, PATCH_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  window.fetch = patchedFetch;
})();
