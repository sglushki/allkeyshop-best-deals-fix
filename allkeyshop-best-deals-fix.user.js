// GENERATED FILE — edit src/* and run npm run build.
// ==UserScript==
// @name         AllKeyShop Best Deals Fix
// @namespace    https://www.allkeyshop.com/
// @version      0.4.0
// @description  Restores AllKeyShop's broken Best Deals sort using its existing deal-score data.
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

  const TARGET_POOL = 240;
  const PROBE_ITERATIONS = 7;
  const MAX_FETCH_PAGES = 16;
  const FETCH_CONCURRENCY = 4;

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
function isBestDealsRequest(
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
function buildCandidateUrl(
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
function getItemDealScore(item) {
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
function getItemKey(item) {
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
function mergeAndSortItems(pages) {
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


  function log(...args) {
    console.log('[AKS Best Deals Fix]', ...args);
  }

  function requestUrl(input) {
    return input instanceof Request ? input.url : String(input);
  }

  async function requestJson(url) {
    const response = await nativeFetch.call(window, url.toString());

    // The catalogue endpoint uses 404 for some empty filtered result sets.
    // During threshold probing that means "zero matches", not a fatal error.
    if (response.status === 404) {
      return {
        items: [],
        pagination: {
          total: 0,
          per_page: Number(url.searchParams.get('per_page')) || 24,
          pagenum: Number(url.searchParams.get('pagenum')) || 1,
          total_pages: 0,
        },
        facets: {},
      };
    }

    if (!response.ok) {
      throw new Error(`Candidate request failed: HTTP ${response.status}`);
    }

    return response.json();
  }

  async function probeThreshold(originalUrl, threshold, perPage) {
    const url = buildCandidateUrl(
      originalUrl,
      { threshold, page: 1, perPage },
      location.href
    );
    const data = await requestJson(url);

    return {
      threshold,
      total: Number(data?.pagination?.total ?? 0),
      data,
    };
  }

  async function findCandidateThreshold(originalUrl, perPage, target) {
    let low = 0;
    let high = 1;

    // threshold=0 is the known-good baseline. We retain the highest threshold
    // that still leaves enough candidates to build the requested result pool.
    let bestEnough = await probeThreshold(originalUrl, 0, perPage);

    if (bestEnough.total === 0) {
      throw new Error(
        'Catalogue returned zero products at deal_score_min=0'
      );
    }

    for (let i = 0; i < PROBE_ITERATIONS; i++) {
      const threshold = (low + high) / 2;
      const result = await probeThreshold(originalUrl, threshold, perPage);

      log(
        `probe ${i + 1}/${PROBE_ITERATIONS}`,
        `score >= ${threshold.toFixed(4)}`,
        `→ ${result.total} products`
      );

      if (result.total >= target) {
        bestEnough = result;
        low = threshold;
      } else {
        high = threshold;
      }
    }

    return bestEnough;
  }

  async function fetchCandidatePool(
    originalUrl,
    threshold,
    total,
    perPage
  ) {
    const pageCount = Math.min(
      Math.ceil(total / perPage),
      MAX_FETCH_PAGES
    );
    const pages = [];

    for (let start = 1; start <= pageCount; start += FETCH_CONCURRENCY) {
      const batch = [];

      for (
        let page = start;
        page < Math.min(start + FETCH_CONCURRENCY, pageCount + 1);
        page++
      ) {
        const url = buildCandidateUrl(
          originalUrl,
          { threshold, page, perPage },
          location.href
        );

        batch.push(requestJson(url).then((data) => ({ page, data })));
      }

      pages.push(...(await Promise.all(batch)));
    }

    pages.sort((a, b) => a.page - b.page);
    return pages;
  }

  function createSyntheticResponse(
    template,
    items,
    requestedPage,
    requestedPerPage,
    threshold
  ) {
    const start = (requestedPage - 1) * requestedPerPage;
    const pageItems = items.slice(start, start + requestedPerPage);

    const body = {
      ...template,
      items: pageItems,
      pagination: {
        ...(template?.pagination ?? {}),
        total: items.length,
        per_page: requestedPerPage,
        pagenum: requestedPage,
        total_pages: Math.max(1, Math.ceil(items.length / requestedPerPage)),
      },
    };

    log(
      `returning page ${requestedPage}`,
      `${pageItems.length} items`,
      `from ${items.length} locally ranked candidates`,
      `threshold=${threshold.toFixed(4)}`
    );

    return new Response(JSON.stringify(body), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function rebuildBestDeals(originalUrl) {
    const original = new URL(originalUrl, location.href);
    const requestedPage = Math.max(
      1,
      Number(original.searchParams.get('pagenum')) || 1
    );
    const requestedPerPage = Math.max(
      1,
      Number(original.searchParams.get('per_page')) || 24
    );

    const needed = requestedPage * requestedPerPage;
    const targetPool = Math.min(
      Math.max(TARGET_POOL, needed * 2),
      MAX_FETCH_PAGES * requestedPerPage
    );

    log('intercepted broken Best Deals request');
    log(`target candidate pool: ~${targetPool}`);

    const probe = await findCandidateThreshold(
      originalUrl,
      requestedPerPage,
      targetPool
    );

    log(
      'selected threshold:',
      probe.threshold.toFixed(6),
      `(${probe.total} matching products)`
    );

    const pages = await fetchCandidatePool(
      originalUrl,
      probe.threshold,
      probe.total,
      requestedPerPage
    );

    if (!pages.length) {
      throw new Error('No candidate pages were returned');
    }

    const sorted = mergeAndSortItems(pages);

    if (!sorted.length) {
      throw new Error('No deal-score candidates were found');
    }

    console.table(
      sorted.slice(0, 15).map((item, index) => ({
        rank: index + 1,
        game:
          item?.meta?.name ?? item?.products?.[0]?.name ?? 'Unknown',
        dealScore: getItemDealScore(item),
      }))
    );

    return createSyntheticResponse(
      pages[0].data,
      sorted,
      requestedPage,
      requestedPerPage,
      probe.threshold
    );
  }

  async function patchedFetch(input, init) {
    const url = requestUrl(input);

    let matches = false;
    try {
      matches = isBestDealsRequest(url, location.href);
    } catch {
      return Reflect.apply(nativeFetch, this, arguments);
    }

    if (!matches) {
      return Reflect.apply(nativeFetch, this, arguments);
    }

    try {
      return await rebuildBestDeals(url);
    } catch (error) {
      // Do not masquerade as a successful Best Deals result by silently
      // returning price-sorted products. A visible failure is diagnosable.
      console.error(
        '[AKS Best Deals Fix] Best Deals reconstruction failed:',
        error
      );
      throw error;
    }
  }

  Object.defineProperty(patchedFetch, PATCH_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  window.fetch = patchedFetch;
  log('v0.4 installed — local deal-score ranking enabled');
})();
