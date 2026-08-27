import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCandidateUrl,
  getItemDealScore,
  getItemKey,
  isBestDealsRequest,
  mergeAndSortItems,
} from '../src/catalogue-ranking.mjs';

const BROKEN_REQUEST =
  'https://www.allkeyshop.com/api/v2-1-250304/vakrs_catalogv2.php?' +
  'action=CatalogV2&locale=en&currency=USD&deal_score_min=0&' +
  'deal_score_max=1&sort_field=deal_score&sort_order=desc&' +
  'pagenum=1&per_page=24&type=game&activation_country=US';

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

test('builds neutral candidate requests without losing active filters', () => {
  const url = buildCandidateUrl(BROKEN_REQUEST, {
    threshold: 0.8125,
    page: 3,
    perPage: 24,
  });

  assert.equal(url.searchParams.get('sort_field'), 'id');
  assert.equal(url.searchParams.get('sort_order'), 'asc');
  assert.equal(url.searchParams.get('deal_score_min'), '0.812500');
  assert.equal(url.searchParams.get('deal_score_max'), '1');
  assert.equal(url.searchParams.get('pagenum'), '3');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(url.searchParams.get('type'), 'game');
  assert.equal(url.searchParams.get('activation_country'), 'US');
  assert.equal(url.searchParams.get('currency'), 'USD');
});

test('uses the best offer deal score for a catalogue item', () => {
  const item = {
    products: [
      { offers: [{ deal_score: 0.71 }, { deal_score: 0.94 }] },
      { offers: [{ deal_score: '0.86' }] },
    ],
  };

  assert.equal(getItemDealScore(item), 0.94);
});

test('returns -1 when an item has no usable deal score', () => {
  assert.equal(getItemDealScore({ products: [{ offers: [{}] }] }), -1);
});

test('prefers the API merge key for de-duplication', () => {
  assert.equal(getItemKey({ meta: { _merge_key: 'pt:42' } }), 'pt:42');
});

test('merges duplicate items and sorts descending by AllKeyShop deal score', () => {
  const pages = [
    {
      data: {
        items: [
          {
            meta: { _merge_key: 'pt:1', name: 'Middle' },
            products: [{ offers: [{ deal_score: 0.75 }] }],
          },
          {
            meta: { _merge_key: 'pt:2', name: 'Best' },
            products: [{ offers: [{ deal_score: 0.96 }] }],
          },
        ],
      },
    },
    {
      data: {
        items: [
          {
            meta: { _merge_key: 'pt:1', name: 'Middle duplicate' },
            products: [{ offers: [{ deal_score: 0.82 }] }],
          },
          {
            meta: { _merge_key: 'pt:3', name: 'Low' },
            products: [{ offers: [{ deal_score: 0.61 }] }],
          },
        ],
      },
    },
  ];

  const sorted = mergeAndSortItems(pages);

  assert.deepEqual(
    sorted.map((item) => item.meta._merge_key),
    ['pt:2', 'pt:1', 'pt:3']
  );
  assert.equal(getItemDealScore(sorted[1]), 0.82);
});
