import test from 'node:test';
import assert from 'node:assert/strict';
import * as adminNavigation from './adminNavigation.js';

const { adminNavigationReducer, initialAdminNavigationState } = adminNavigation;

test('admin navigation groups include each existing grouped section exactly once', () => {
  assert.ok(Array.isArray(adminNavigation.ADMIN_SECTION_GROUPS));
  assert.deepEqual(
    adminNavigation.ADMIN_SECTION_GROUPS.map(({ id, label, sections }) => [
      id,
      label,
      sections.map(({ id: sectionId, label: sectionLabel }) => [sectionId, sectionLabel])
    ]),
    [
      ['catalogue', 'Catalogue', [['products', 'Products'], ['catalogue', 'Categories & Collections']]],
      ['sales', 'Sales', [['orders', 'Orders'], ['customers', 'Customers']]],
      ['operations', 'Operations', [['inventory', 'Inventory'], ['support', 'Support Centre']]],
      ['insights', 'Insights', [['analytics', 'Analytics']]]
    ]
  );
  assert.deepEqual(
    adminNavigation.ADMIN_STANDALONE_SECTIONS.map(({ id, label, placement }) => [id, label, placement]),
    [['dashboard', 'Dashboard', 'top'], ['settings', 'Settings', 'bottom']]
  );
});

test('admin section labels follow the active grouped or standalone section', () => {
  assert.equal(typeof adminNavigation.getAdminSectionLabel, 'function');
  assert.equal(adminNavigation.getAdminSectionLabel('support'), 'Support Centre');
  assert.equal(adminNavigation.getAdminSectionLabel('settings'), 'Settings');
});

test('admin navigation groups toggle independently', () => {
  const initialExpansion = {
    catalogue: false,
    sales: false,
    operations: false,
    insights: false
  };
  assert.deepEqual(initialAdminNavigationState.expandedGroups, initialExpansion);

  const catalogueExpanded = adminNavigationReducer(initialAdminNavigationState, {
    type: 'toggle-group',
    groupId: 'catalogue'
  });
  assert.deepEqual(catalogueExpanded.expandedGroups, {
    catalogue: true,
    sales: false,
    operations: false,
    insights: false
  });

  const salesExpanded = adminNavigationReducer(catalogueExpanded, {
    type: 'toggle-group',
    groupId: 'sales'
  });
  assert.deepEqual(salesExpanded.expandedGroups, {
    catalogue: true,
    sales: true,
    operations: false,
    insights: false
  });
  assert.deepEqual(initialAdminNavigationState.expandedGroups, initialExpansion);
});

test('unknown navigation group ids preserve expansion state', () => {
  const state = {
    isOpen: true,
    expandedGroups: {
      catalogue: true,
      sales: false,
      operations: true,
      insights: false
    }
  };

  const next = adminNavigationReducer(state, { type: 'navigate', groupId: 'unknown' });
  assert.deepEqual(next, { ...state, isOpen: false });
  assert.strictEqual(next.expandedGroups, state.expandedGroups);
});

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
