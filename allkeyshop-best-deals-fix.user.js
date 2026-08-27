// GENERATED FILE — edit src/* and run npm run build.
// ==UserScript==
// @name         AllKeyShop Best Deals Fix
// @namespace    https://www.allkeyshop.com/
// @version      0.5.0
// @description  Reconstructs AllKeyShop's broken Best Deals ranking from live price and discount data.
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

  const FETCH_CONCURRENCY = 6;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const PRICE_SAMPLE_COUNT = 36;

  // Supported server-side sorts are used only to gather a diverse candidate
  // set. Final ordering is always computed locally from discount + reference
  // price. Sequential page counts are intentionally bounded.
  const SECONDARY_STRATEGIES = [
    { sortField: 'popularity_score', sortOrder: 'desc', pages: 12 },
    { sortField: 'rating', sortOrder: 'desc', pages: 8 },
    { sortField: 'release_date', sortOrder: 'desc', pages: 8 },
    { sortField: 'random', sortOrder: 'desc', pages: 12 },
  ];

  const rankingCache = new Map();

  /**
 * Pure helpers for reconstructing AllKeyShop's broken Best Deals sort.
 *
 * The server no longer accepts `deal_score` as a sort field, and the
 * offer-level `deal_score` values observed in valid responses are not useful
 * enough to recreate the historical ordering. Version 0.5 therefore ranks
 * offers from fields the API still returns consistently:
 *
 *   - offers.price
 *   - offers.official_offer_reduction_percent
 *
 * Discount percentage is intentionally the dominant signal. Reference price
 * (inferred from current price and reduction) is a secondary weight.
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
 * Ensure the catalogue response contains every field required by the local
 * scorer, while preserving all fields requested by the application.
 *
 * @param {URL} url
 */
function ensureRankingFields(url) {
  const required = [
    'id',
    'name',
    'link',
    'offers.price',
    'offers.stock_status',
    'offers.official_offer_reduction_percent',
  ];

  const current = (url.searchParams.get('fields') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  const fields = new Set(current);
  for (const field of required) fields.add(field);

  url.searchParams.set('fields', [...fields].join(','));
}

/**
 * Build a valid candidate request while preserving the user's active filters.
 * The broken deal-score filter parameters are removed because live testing
 * showed that they do not produce a trustworthy candidate set.
 *
 * @param {string | URL} rawUrl
 * @param {{sortField: string, sortOrder: string, page: number, perPage: number}} options
 * @param {string | URL} [baseUrl]
 */
function buildCandidateUrl(
  rawUrl,
  { sortField, sortOrder, page, perPage },
  baseUrl = 'https://www.allkeyshop.com/'
) {
  const url = new URL(String(rawUrl), String(baseUrl));

  url.searchParams.delete('deal_score_min');
  url.searchParams.delete('deal_score_max');
  url.searchParams.set('sort_field', String(sortField));
  url.searchParams.set('sort_order', String(sortOrder));
  url.searchParams.set('pagenum', String(page));
  url.searchParams.set('per_page', String(perPage));

  ensureRankingFields(url);
  return url;
}

/**
 * Convert API reduction data into a conventional positive percentage.
 *
 * @param {unknown} value
 */
function normalizeReductionPercent(value) {
  const number = Math.abs(Number(value));

  if (!Number.isFinite(number) || number <= 0 || number >= 100) {
    return 0;
  }

  return number;
}

/**
 * Calculate the locally reconstructed deal score for one offer.
 *
 * Formula:
 *   discountRatio² × log2(referencePrice + 1)
 *
 * Squaring the discount ratio makes discount percentage the primary signal.
 * The logarithmic reference-price term gives a premium-title discount more
 * weight than the same percentage on a very cheap title without allowing MSRP
 * alone to dominate the ranking.
 *
 * @param {object} offer
 */
function scoreOffer(offer) {
  if (!offer || offer.stock_status === 'out_of_stock') {
    return null;
  }

  const currentPrice = Number(offer.price);
  const discountPercent = normalizeReductionPercent(
    offer.official_offer_reduction_percent
  );

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || discountPercent <= 0) {
    return null;
  }

  const discountRatio = discountPercent / 100;
  const remainingRatio = 1 - discountRatio;

  if (remainingRatio <= 0) {
    return null;
  }

  const referencePrice = currentPrice / remainingRatio;

  if (!Number.isFinite(referencePrice) || referencePrice <= currentPrice) {
    return null;
  }

  const score =
    Math.pow(discountRatio, 2) * Math.log2(referencePrice + 1);

  return {
    score,
    currentPrice,
    discountPercent,
    referencePrice,
  };
}

/**
 * Return the strongest offer for a catalogue item under the reconstructed
 * ranking formula.
 *
 * @param {object} item
 */
function getItemBestDeal(item) {
  let best = null;

  for (const product of item?.products ?? []) {
    for (const offer of product?.offers ?? []) {
      const metrics = scoreOffer(offer);
      if (!metrics) continue;

      if (!best || metrics.score > best.score) {
        best = {
          ...metrics,
          offer,
          product,
        };
      }
    }
  }

  return best;
}

/**
 * Stable key used to de-duplicate catalogue items collected from multiple
 * supported sort strategies.
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
 * Merge candidate pages, remove duplicates, discard products with no usable
 * reduction information, and rank descending by the local Best Deals score.
 *
 * @param {Array<{data?: {items?: object[]}}>} pages
 */
function mergeAndRankItems(pages) {
  const unique = new Map();

  for (const page of pages) {
    for (const item of page?.data?.items ?? []) {
      const deal = getItemBestDeal(item);
      if (!deal) continue;

      const key = getItemKey(item);
      const existing = unique.get(key);
      const existingDeal = existing ? getItemBestDeal(existing) : null;

      if (!existing || !existingDeal || deal.score > existingDeal.score) {
        unique.set(key, item);
      }
    }
  }

  return [...unique.values()].sort((a, b) => {
    const aDeal = getItemBestDeal(a);
    const bDeal = getItemBestDeal(b);

    if (!aDeal && !bDeal) return 0;
    if (!aDeal) return 1;
    if (!bDeal) return -1;

    return (
      bDeal.score - aDeal.score ||
      bDeal.discountPercent - aDeal.discountPercent ||
      bDeal.referencePrice - aDeal.referencePrice
    );
  });
}

/**
 * Select page numbers across a large price-sorted catalogue. Geometric
 * spacing samples the cheap end densely while still reaching the middle and
 * expensive end of the active result set.
 *
 * @param {number} totalPages
 * @param {number} sampleCount
 */
function geometricPageSample(totalPages, sampleCount = 36) {
  const total = Math.max(1, Math.floor(Number(totalPages) || 1));
  const count = Math.max(1, Math.floor(Number(sampleCount) || 1));
  const pages = new Set();

  const densePrefix = Math.min(12, total);
  for (let page = 1; page <= densePrefix; page++) {
    pages.add(page);
  }

  if (total > 1) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 1 : i / (count - 1);
      const page = Math.round(Math.exp(Math.log(total) * t));
      pages.add(Math.min(total, Math.max(1, page)));
    }
  }

  return [...pages].sort((a, b) => a - b);
}


  function log(...args) {
    console.log('[AKS Best Deals Fix]', ...args);
  }

  function requestUrl(input) {
    return input instanceof Request ? input.url : String(input);
  }

  function makeCacheKey(rawUrl) {
    const url = new URL(rawUrl, location.href);

    for (const key of [
      'sort_field',
      'sort_order',
      'pagenum',
      'deal_score_min',
      'deal_score_max',
    ]) {
      url.searchParams.delete(key);
    }

    url.searchParams.sort();
    return url.toString();
  }

  async function requestJson(url) {
    const response = await nativeFetch.call(window, url.toString());

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Candidate request failed: HTTP ${response.status}`);
    }

    return response.json();
  }

  async function fetchTask(originalUrl, task, perPage) {
    const url = buildCandidateUrl(
      originalUrl,
      {
        sortField: task.sortField,
        sortOrder: task.sortOrder,
        page: task.page,
        perPage,
      },
      location.href
    );

    try {
      const data = await requestJson(url);
      return data ? { task, data } : null;
    } catch (error) {
      console.warn(
        '[AKS Best Deals Fix] candidate request skipped:',
        task,
        error
      );
      return null;
    }
  }

  async function runTasks(originalUrl, tasks, perPage) {
    const results = [];

    for (let start = 0; start < tasks.length; start += FETCH_CONCURRENCY) {
      const batch = tasks.slice(start, start + FETCH_CONCURRENCY);
      const resolved = await Promise.all(
        batch.map((task) => fetchTask(originalUrl, task, perPage))
      );

      results.push(...resolved.filter(Boolean));
    }

    return results;
  }

  function buildSecondaryTasks(totalPages) {
    const tasks = [];

    const pricePages = geometricPageSample(totalPages, PRICE_SAMPLE_COUNT);
    for (const page of pricePages) {
      if (page === 1) continue;
      tasks.push({ sortField: 'price', sortOrder: 'asc', page });
    }

    for (const strategy of SECONDARY_STRATEGIES) {
      for (let page = 1; page <= strategy.pages; page++) {
        tasks.push({
          sortField: strategy.sortField,
          sortOrder: strategy.sortOrder,
          page,
        });
      }
    }

    return tasks;
  }

  async function buildRanking(originalUrl, perPage) {
    // Price page 1 is a verified-valid request shape and gives us the active
    // catalogue's page count for distribution-aware sampling.
    const seedTask = { sortField: 'price', sortOrder: 'asc', page: 1 };
    const seed = await fetchTask(originalUrl, seedTask, perPage);

    if (!seed) {
      throw new Error('Could not fetch a valid catalogue seed page');
    }

    const totalPages = Math.max(
      1,
      Number(seed.data?.pagination?.total_pages) || 1
    );
    const tasks = buildSecondaryTasks(totalPages);

    log(
      `sampling ${tasks.length + 1} catalogue pages`,
      `across ${totalPages} active pages`
    );

    const rest = await runTasks(originalUrl, tasks, perPage);
    const pages = [seed, ...rest];
    const ranked = mergeAndRankItems(pages);

    if (!ranked.length) {
      throw new Error(
        'No products with usable price + official discount data were found'
      );
    }

    console.table(
      ranked.slice(0, 20).map((item, index) => {
        const deal = getItemBestDeal(item);

        return {
          rank: index + 1,
          game: item?.meta?.name ?? item?.products?.[0]?.name ?? 'Unknown',
          discount: `${deal.discountPercent.toFixed(0)}%`,
          price: deal.currentPrice.toFixed(2),
          referencePrice: deal.referencePrice.toFixed(2),
          score: deal.score.toFixed(4),
        };
      })
    );

    return {
      template: seed.data,
      ranked,
      sampledPages: pages.length,
      builtAt: Date.now(),
    };
  }

  async function getRanking(originalUrl, perPage) {
    const key = makeCacheKey(originalUrl);
    const cached = rankingCache.get(key);

    if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
      log('using cached Best Deals ranking');
      return cached;
    }

    const ranking = await buildRanking(originalUrl, perPage);
    rankingCache.set(key, ranking);
    return ranking;
  }

  function createSyntheticResponse(
    template,
    ranked,
    requestedPage,
    requestedPerPage,
    sampledPages
  ) {
    const start = (requestedPage - 1) * requestedPerPage;
    const pageItems = ranked.slice(start, start + requestedPerPage);

    const body = {
      ...template,
      items: pageItems,
      pagination: {
        ...(template?.pagination ?? {}),
        total: ranked.length,
        per_page: requestedPerPage,
        pagenum: requestedPage,
        total_pages: Math.max(1, Math.ceil(ranked.length / requestedPerPage)),
      },
    };

    log(
      `returning reconstructed page ${requestedPage}`,
      `(${pageItems.length} items; ${ranked.length} ranked candidates;`,
      `${sampledPages} catalogue pages sampled)`
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

    log('intercepted broken Best Deals request');

    const ranking = await getRanking(originalUrl, requestedPerPage);

    return createSyntheticResponse(
      ranking.template,
      ranking.ranked,
      requestedPage,
      requestedPerPage,
      ranking.sampledPages
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
  log('v0.5 installed — discount-weighted local ranking enabled');
})();
