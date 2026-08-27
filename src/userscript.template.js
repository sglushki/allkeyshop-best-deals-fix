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

  /*__CATALOGUE_HELPERS__*/

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
