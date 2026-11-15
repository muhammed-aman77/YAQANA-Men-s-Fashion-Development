import test from 'node:test';
import assert from 'node:assert/strict';
import { isCookieAuthMode, readCookieValue } from '../src/utils/authMode.js';

test('cookie auth is enabled only by the explicit Vite cookie mode', () => {
  assert.equal(isCookieAuthMode('cookie'), true);
  assert.equal(isCookieAuthMode('bearer'), false);
  assert.equal(isCookieAuthMode(undefined), false);
});

test('CSRF token lookup reads the exact cookie and safely handles malformed values', () => {
  assert.equal(readCookieValue('theme=light; yaqana_csrf=a%2Bb; other=x', 'yaqana_csrf'), 'a+b');
  assert.equal(readCookieValue('not_yaqana_csrf=wrong', 'yaqana_csrf'), null);
  assert.equal(readCookieValue('yaqana_csrf=%E0%A4%A', 'yaqana_csrf'), null);
});
