// GENERATED FILE — edit src/* and run npm run build.
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

  function rewriteCatalogueUrl(
  rawUrl,
  baseUrl = 'https://www.allkeyshop.com/'
) {
  const url = new URL(String(rawUrl), String(baseUrl));

  const isAllKeyShop = url.hostname.toLowerCase() === 'www.allkeyshop.com';
  const isCatalogueEndpoint = /\/api\/[^/]+\/vakrs_catalogv2\.php$/i.test(
    url.pathname
  );
  const isCatalogueAction = url.searchParams.get('action') === 'CatalogV2';
  const usesObsoleteSort = url.searchParams.get('sort_field') === 'deal_score';

  if (
    !isAllKeyShop ||
    !isCatalogueEndpoint ||
    !isCatalogueAction ||
    !usesObsoleteSort
  ) {
    return null;
  }

  url.searchParams.set('sort_field', 'list_score');
  url.searchParams.set('sort_order', 'desc');

  return url.toString();
}

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
