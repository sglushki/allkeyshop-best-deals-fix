// Generated from src/. Run npm run build after source changes.
// ==UserScript==
// @name         AllKeyShop Best Deals Fix
// @namespace    https://www.allkeyshop.com/
// @version      0.5.1
// @description  Restores AllKeyShop's Best Deals catalogue ranking.
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
  const DEBUG = false;

  const SECONDARY_STRATEGIES = [
    { sortField: 'popularity_score', sortOrder: 'desc', pages: 12 },
    { sortField: 'rating', sortOrder: 'desc', pages: 8 },
    { sortField: 'release_date', sortOrder: 'desc', pages: 8 },
    { sortField: 'random', sortOrder: 'desc', pages: 12 },
  ];

  const rankingCache = new Map();

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

function ensureRankingFields(url) {
  const requiredFields = [
    'id',
    'name',
    'link',
    'offers.price',
    'offers.stock_status',
    'offers.official_offer_reduction_percent',
  ];

  const requestedFields = (url.searchParams.get('fields') ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  const fields = new Set([...requestedFields, ...requiredFields]);
  url.searchParams.set('fields', [...fields].join(','));
}

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

function normalizeReductionPercent(value) {
  const percent = Math.abs(Number(value));
  return Number.isFinite(percent) && percent > 0 && percent < 100
    ? percent
    : 0;
}

function scoreOffer(offer) {
  if (!offer || offer.stock_status === 'out_of_stock') {
    return null;
  }

  const currentPrice = Number(offer.price);
  const discountPercent = normalizeReductionPercent(
    offer.official_offer_reduction_percent
  );

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !discountPercent) {
    return null;
  }

  const discountRatio = discountPercent / 100;
  const referencePrice = currentPrice / (1 - discountRatio);

  if (!Number.isFinite(referencePrice) || referencePrice <= currentPrice) {
    return null;
  }

  const score = discountRatio ** 2 * Math.log2(referencePrice + 1);

  return {
    score,
    currentPrice,
    discountPercent,
    referencePrice,
  };
}

function getItemBestDeal(item) {
  let bestDeal = null;

  for (const product of item?.products ?? []) {
    for (const offer of product?.offers ?? []) {
      const metrics = scoreOffer(offer);
      if (!metrics || (bestDeal && metrics.score <= bestDeal.score)) {
        continue;
      }

      bestDeal = { ...metrics, offer, product };
    }
  }

  return bestDeal;
}

function getItemKey(item) {
  if (item?.meta?._merge_key) {
    return item.meta._merge_key;
  }

  const productIds = (item?.products ?? [])
    .map((product) => product?.id)
    .filter(Boolean);

  if (productIds.length) {
    return productIds.join(',');
  }

  return item?.meta?.link ?? item?.meta?.name ?? JSON.stringify(item).slice(0, 200);
}

function compareDeals(a, b) {
  return (
    b.deal.score - a.deal.score ||
    b.deal.discountPercent - a.deal.discountPercent ||
    b.deal.referencePrice - a.deal.referencePrice
  );
}

function mergeAndRankItems(pages) {
  const candidates = new Map();

  for (const page of pages) {
    for (const item of page?.data?.items ?? []) {
      const deal = getItemBestDeal(item);
      if (!deal) {
        continue;
      }

      const key = getItemKey(item);
      const existing = candidates.get(key);

      if (!existing || deal.score > existing.deal.score) {
        candidates.set(key, { item, deal });
      }
    }
  }

  return [...candidates.values()]
    .sort(compareDeals)
    .map(({ item }) => item);
}

function geometricPageSample(totalPages, sampleCount = 36) {
  const total = Math.max(1, Math.floor(Number(totalPages) || 1));
  const count = Math.max(1, Math.floor(Number(sampleCount) || 1));
  const pages = new Set();

  for (let page = 1; page <= Math.min(12, total); page++) {
    pages.add(page);
  }

  if (total > 1) {
    for (let index = 0; index < count; index++) {
      const position = count === 1 ? 1 : index / (count - 1);
      const page = Math.round(Math.exp(Math.log(total) * position));
      pages.add(Math.min(total, Math.max(1, page)));
    }
  }

  return [...pages].sort((a, b) => a - b);
}


  function debug(...args) {
    if (DEBUG) {
      console.debug('[AKS Best Deals Fix]', ...args);
    }
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
      console.warn('[AKS Best Deals Fix] skipped candidate request', task, error);
      return null;
    }
  }

  async function runTasks(originalUrl, tasks, perPage) {
    const results = [];

    for (let offset = 0; offset < tasks.length; offset += FETCH_CONCURRENCY) {
      const batch = tasks.slice(offset, offset + FETCH_CONCURRENCY);
      const resolved = await Promise.all(
        batch.map((task) => fetchTask(originalUrl, task, perPage))
      );

      results.push(...resolved.filter(Boolean));
    }

    return results;
  }

  function buildSamplingTasks(totalPages) {
    const tasks = [];

    for (const page of geometricPageSample(totalPages, PRICE_SAMPLE_COUNT)) {
      if (page !== 1) {
        tasks.push({ sortField: 'price', sortOrder: 'asc', page });
      }
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
    const seed = await fetchTask(
      originalUrl,
      { sortField: 'price', sortOrder: 'asc', page: 1 },
      perPage
    );

    if (!seed) {
      throw new Error('Could not fetch a catalogue seed page');
    }

    const totalPages = Math.max(
      1,
      Number(seed.data?.pagination?.total_pages) || 1
    );
    const tasks = buildSamplingTasks(totalPages);

    debug(`sampling ${tasks.length + 1} pages from ${totalPages} active pages`);

    const pages = [seed, ...(await runTasks(originalUrl, tasks, perPage))];
    const ranked = mergeAndRankItems(pages);

    if (!ranked.length) {
      throw new Error('No discounted products were found in the candidate set');
    }

    if (DEBUG) {
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
    }

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
      debug('using cached ranking');
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
    requestedPerPage
  ) {
    const start = (requestedPage - 1) * requestedPerPage;
    const items = ranked.slice(start, start + requestedPerPage);

    const body = {
      ...template,
      items,
      pagination: {
        ...(template?.pagination ?? {}),
        total: ranked.length,
        per_page: requestedPerPage,
        pagenum: requestedPage,
        total_pages: Math.max(1, Math.ceil(ranked.length / requestedPerPage)),
      },
    };

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

    const ranking = await getRanking(originalUrl, requestedPerPage);
    debug(`ranked ${ranking.ranked.length} products from ${ranking.sampledPages} pages`);

    return createSyntheticResponse(
      ranking.template,
      ranking.ranked,
      requestedPage,
      requestedPerPage
    );
  }

  async function patchedFetch(input, init) {
    const url = requestUrl(input);

    try {
      if (!isBestDealsRequest(url, location.href)) {
        return Reflect.apply(nativeFetch, this, arguments);
      }
    } catch {
      return Reflect.apply(nativeFetch, this, arguments);
    }

    try {
      return await rebuildBestDeals(url);
    } catch (error) {
      console.error('[AKS Best Deals Fix] ranking failed', error);
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
})();
