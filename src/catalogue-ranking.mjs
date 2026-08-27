/**
 * Pure helpers for reconstructing AllKeyShop's removed server-side
 * `deal_score` sort from the deal-score data that the API still exposes.
 */

/**
 * Return true only for the broken AllKeyShop CatalogV2 Best Deals request.
 *
 * @param {string | URL} rawUrl
 * @param {string | URL} [baseUrl]
 */
export function isBestDealsRequest(
  rawUrl,
  baseUrl = 'https://www.allkeyshop.com/'
) {
  const url = new URL(String(rawUrl), String(baseUrl));

  return (
    url.hostname.toLowerCase() === 'www.allkeyshop.com' &&
    /\/api\/[^/]+\/vakrs_catalogv2\.php$/i.test(url.pathname) &&
    url.searchParams.get('action') === 'CatalogV2' &&
    url.searchParams.get('sort_field') === 'deal_score'
  );
}

/**
 * Build a valid candidate request while preserving all of the user's active
 * filters. Candidate acquisition deliberately uses stable ID ordering so it
 * is not biased toward low prices.
 *
 * @param {string | URL} rawUrl
 * @param {{threshold: number, page: number, perPage: number}} options
 * @param {string | URL} [baseUrl]
 */
export function buildCandidateUrl(
  rawUrl,
  { threshold, page, perPage },
  baseUrl = 'https://www.allkeyshop.com/'
) {
  const url = new URL(String(rawUrl), String(baseUrl));

  url.searchParams.set('sort_field', 'id');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('deal_score_min', Number(threshold).toFixed(6));
  url.searchParams.set('deal_score_max', '1');
  url.searchParams.set('pagenum', String(page));
  url.searchParams.set('per_page', String(perPage));

  return url;
}

/**
 * AllKeyShop exposes deal_score per offer. A catalogue item can contain
 * multiple products/offers, so the item's comparable score is its best offer.
 *
 * @param {object} item
 */
export function getItemDealScore(item) {
  let best = -Infinity;

  for (const product of item?.products ?? []) {
    for (const offer of product?.offers ?? []) {
      const score = Number(offer?.deal_score);

      if (Number.isFinite(score)) {
        best = Math.max(best, score);
      }
    }
  }

  return Number.isFinite(best) ? best : -1;
}

/**
 * Stable key used to de-duplicate catalogue items collected across pages.
 *
 * @param {object} item
 */
export function getItemKey(item) {
  if (item?.meta?._merge_key) {
    return item.meta._merge_key;
  }

  const ids = (item?.products ?? [])
    .map((product) => product?.id)
    .filter(Boolean);

  if (ids.length) {
    return ids.join(',');
  }

  return (
    item?.meta?.link ??
    item?.meta?.name ??
    JSON.stringify(item).slice(0, 200)
  );
}

/**
 * Merge page responses, de-duplicate items, and sort descending by the
 * deal_score values returned by AllKeyShop itself.
 *
 * @param {Array<{data?: {items?: object[]}}>} pages
 */
export function mergeAndSortItems(pages) {
  const unique = new Map();

  for (const page of pages) {
    for (const item of page?.data?.items ?? []) {
      const key = getItemKey(item);
      const existing = unique.get(key);

      if (!existing || getItemDealScore(item) > getItemDealScore(existing)) {
        unique.set(key, item);
      }
    }
  }

  return [...unique.values()].sort(
    (a, b) => getItemDealScore(b) - getItemDealScore(a)
  );
}
