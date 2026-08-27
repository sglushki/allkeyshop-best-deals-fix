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
export function buildCandidateUrl(
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
export function normalizeReductionPercent(value) {
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
export function scoreOffer(offer) {
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
export function getItemBestDeal(item) {
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
 * Merge candidate pages, remove duplicates, discard products with no usable
 * reduction information, and rank descending by the local Best Deals score.
 *
 * @param {Array<{data?: {items?: object[]}}>} pages
 */
export function mergeAndRankItems(pages) {
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
export function geometricPageSample(totalPages, sampleCount = 36) {
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
