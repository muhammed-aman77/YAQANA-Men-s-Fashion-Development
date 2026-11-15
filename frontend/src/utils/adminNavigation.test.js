import test from 'node:test';
import assert from 'node:assert/strict';
import { adminNavigationReducer, initialAdminNavigationState } from './adminNavigation.js';

test('mobile admin navigation opens, toggles, and closes after choosing a section', () => {
  const opened = adminNavigationReducer(initialAdminNavigationState, { type: 'open' });
  assert.equal(opened.isOpen, true);

  const toggled = adminNavigationReducer(opened, { type: 'toggle' });
  assert.equal(toggled.isOpen, false);

  const reopened = adminNavigationReducer(toggled, { type: 'open' });
  const afterNavigation = adminNavigationReducer(reopened, { type: 'navigate' });
  assert.equal(afterNavigation.isOpen, false);
});

test('Escape closes an open mobile admin navigation drawer', () => {
  const opened = adminNavigationReducer(initialAdminNavigationState, { type: 'open' });
  const closed = adminNavigationReducer(opened, { type: 'escape' });
  assert.equal(closed.isOpen, false);
});
