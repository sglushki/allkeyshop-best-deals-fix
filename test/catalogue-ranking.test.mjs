import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCandidateUrl,
  geometricPageSample,
  getItemBestDeal,
  getItemKey,
  isBestDealsRequest,
  mergeAndRankItems,
  normalizeReductionPercent,
  scoreOffer,
} from '../src/catalogue-ranking.mjs';

const BROKEN_REQUEST =
  'https://www.allkeyshop.com/api/v2-1-250304/vakrs_catalogv2.php?' +
  'action=CatalogV2&locale=en&currency=USD&deal_score_min=0&' +
  'deal_score_max=1&sort_field=deal_score&sort_order=desc&' +
  'pagenum=1&per_page=24&type=game&activation_country=US&' +
  'fields=id,name,offers.price';

test('recognizes the broken Best Deals request', () => {
  assert.equal(isBestDealsRequest(BROKEN_REQUEST), true);
});

test('ignores supported catalogue sorts', () => {
  assert.equal(
    isBestDealsRequest(BROKEN_REQUEST.replace('deal_score&sort_order', 'price&sort_order')),
    false
  );
});

test('ignores lookalike endpoints on other hosts', () => {
  assert.equal(
    isBestDealsRequest(BROKEN_REQUEST.replace('www.allkeyshop.com', 'example.com')),
    false
  );
});

test('builds supported candidate requests and removes dead deal-score filters', () => {
  const url = buildCandidateUrl(BROKEN_REQUEST, {
    sortField: 'popularity_score',
    sortOrder: 'desc',
    page: 3,
    perPage: 24,
  });

  assert.equal(url.searchParams.get('sort_field'), 'popularity_score');
  assert.equal(url.searchParams.get('sort_order'), 'desc');
  assert.equal(url.searchParams.has('deal_score_min'), false);
  assert.equal(url.searchParams.has('deal_score_max'), false);
  assert.equal(url.searchParams.get('pagenum'), '3');
  assert.equal(url.searchParams.get('type'), 'game');
  assert.equal(url.searchParams.get('activation_country'), 'US');

  const fields = new Set(url.searchParams.get('fields').split(','));
  assert.equal(fields.has('offers.price'), true);
  assert.equal(fields.has('offers.stock_status'), true);
  assert.equal(fields.has('offers.official_offer_reduction_percent'), true);
});

test('normalizes signed reduction percentages', () => {
  assert.equal(normalizeReductionPercent(-90), 90);
  assert.equal(normalizeReductionPercent(80), 80);
  assert.equal(normalizeReductionPercent(0), 0);
  assert.equal(normalizeReductionPercent(100), 0);
});

test('infers reference price and scores a discounted offer', () => {
  const deal = scoreOffer({
    price: 8.9,
    stock_status: 'in_stock',
    official_offer_reduction_percent: 90,
  });

  assert.ok(deal);
  assert.ok(Math.abs(deal.referencePrice - 89) < 0.001);
  assert.equal(deal.discountPercent, 90);
  assert.ok(deal.score > 0);
});

test('discount percentage dominates while MSRP remains a secondary weight', () => {
  const premium90 = scoreOffer({ price: 8.9, official_offer_reduction_percent: 90 });
  const cheap90 = scoreOffer({ price: 0.499, official_offer_reduction_percent: 90 });
  const premium60 = scoreOffer({ price: 28, official_offer_reduction_percent: 60 });

  assert.ok(premium90.score > cheap90.score);
  assert.ok(premium90.score > premium60.score);
});

test('ignores free, undiscounted, and out-of-stock offers', () => {
  assert.equal(scoreOffer({ price: 0, official_offer_reduction_percent: 90 }), null);
  assert.equal(scoreOffer({ price: 20, official_offer_reduction_percent: 0 }), null);
  assert.equal(
    scoreOffer({
      price: 5,
      stock_status: 'out_of_stock',
      official_offer_reduction_percent: 90,
    }),
    null
  );
});

test('chooses the strongest offer on a catalogue item', () => {
  const item = {
    products: [
      {
        offers: [
          { price: 3, official_offer_reduction_percent: 40 },
          { price: 8.9, official_offer_reduction_percent: 90 },
        ],
      },
    ],
  };

  const deal = getItemBestDeal(item);
  assert.equal(deal.discountPercent, 90);
  assert.ok(Math.abs(deal.referencePrice - 89) < 0.001);
});

test('prefers the API merge key for de-duplication', () => {
  assert.equal(getItemKey({ meta: { _merge_key: 'pt:42' } }), 'pt:42');
});

test('merges duplicate items and ranks by reconstructed deal quality', () => {
  const pages = [
    {
      data: {
        items: [
          {
            meta: { _merge_key: 'pt:1', name: 'Cheap 90%' },
            products: [{ offers: [{ price: 0.499, official_offer_reduction_percent: 90 }] }],
          },
          {
            meta: { _merge_key: 'pt:2', name: 'Premium 90%' },
            products: [{ offers: [{ price: 8.9, official_offer_reduction_percent: 90 }] }],
          },
        ],
      },
    },
    {
      data: {
        items: [
          {
            meta: { _merge_key: 'pt:1', name: 'Cheap duplicate' },
            products: [{ offers: [{ price: 0.399, official_offer_reduction_percent: 80 }] }],
          },
          {
            meta: { _merge_key: 'pt:3', name: 'Premium 60%' },
            products: [{ offers: [{ price: 28, official_offer_reduction_percent: 60 }] }],
          },
        ],
      },
    },
  ];

  const ranked = mergeAndRankItems(pages);

  assert.equal(ranked[0].meta._merge_key, 'pt:2');
  assert.equal(new Set(ranked.map((item) => item.meta._merge_key)).size, 3);
});

test('geometric page sampling includes the cheap prefix and reaches the last page', () => {
  const pages = geometricPageSample(5387, 36);

  assert.deepEqual(pages.slice(0, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(pages.at(-1), 5387);
  assert.ok(pages.length > 20);
});
