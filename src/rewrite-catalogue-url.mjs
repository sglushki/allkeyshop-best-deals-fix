/**
 * Rewrite the obsolete AllKeyShop catalogue sort field used by the
 * "Best deals" UI into the closest sort field accepted by the current API.
 *
 * The function is intentionally pure so the request-matching behavior can be
 * unit tested independently of the browser/userscript runtime.
 *
 * @param {string | URL} rawUrl Request URL to inspect.
 * @param {string | URL} [baseUrl] Base URL used when rawUrl is relative.
 * @returns {string | null} Rewritten URL, or null when the request is out of scope.
 */
export function rewriteCatalogueUrl(
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
