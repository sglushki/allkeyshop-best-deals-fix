import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteCatalogueUrl } from '../src/rewrite-catalogue-url.mjs';

const BROKEN_REQUEST =
  'https://www.allkeyshop.com/api/v2-1-250304/vakrs_catalogv2.php?' +
  'action=CatalogV2&locale=en&currency=USD&sort_field=deal_score&' +
  'sort_order=desc&pagenum=1&per_page=24&type=game&activation_country=US';

test('rewrites the obsolete Best deals sort field', () => {
  const result = rewriteCatalogueUrl(BROKEN_REQUEST);
  const url = new URL(result);

  assert.equal(url.searchParams.get('sort_field'), 'list_score');
  assert.equal(url.searchParams.get('sort_order'), 'desc');
});

test('preserves unrelated catalogue parameters', () => {
  const result = rewriteCatalogueUrl(BROKEN_REQUEST);
  const url = new URL(result);

  assert.equal(url.searchParams.get('currency'), 'USD');
  assert.equal(url.searchParams.get('pagenum'), '1');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(url.searchParams.get('type'), 'game');
  assert.equal(url.searchParams.get('activation_country'), 'US');
});

test('normalizes Best deals to descending order', () => {
  const result = rewriteCatalogueUrl(
    BROKEN_REQUEST.replace('sort_order=desc', 'sort_order=asc')
  );
  const url = new URL(result);

  assert.equal(url.searchParams.get('sort_order'), 'desc');
});

test('ignores already-supported price sorting', () => {
  const request = BROKEN_REQUEST.replace('deal_score', 'price');
  assert.equal(rewriteCatalogueUrl(request), null);
});

test('ignores other API actions', () => {
  const request = BROKEN_REQUEST.replace('action=CatalogV2', 'action=Other');
  assert.equal(rewriteCatalogueUrl(request), null);
});

test('ignores lookalike endpoints on other hosts', () => {
  const request = BROKEN_REQUEST.replace(
    'https://www.allkeyshop.com',
    'https://example.com'
  );
  assert.equal(rewriteCatalogueUrl(request), null);
});

test('supports relative catalogue URLs when given an AllKeyShop base URL', () => {
  const relative =
    '/api/v2-1-250304/vakrs_catalogv2.php?action=CatalogV2&' +
    'sort_field=deal_score&sort_order=desc';

  const result = rewriteCatalogueUrl(
    relative,
    'https://www.allkeyshop.com/blog/en-us/products/'
  );

  assert.equal(new URL(result).searchParams.get('sort_field'), 'list_score');
});
