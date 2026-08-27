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

export function normalizeReductionPercent(value) {
  const percent = Math.abs(Number(value));
  return Number.isFinite(percent) && percent > 0 && percent < 100
    ? percent
    : 0;
}

export function scoreOffer(offer) {
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

export function getItemBestDeal(item) {
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

export function getItemKey(item) {
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

export function mergeAndRankItems(pages) {
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

export function geometricPageSample(totalPages, sampleCount = 36) {
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
