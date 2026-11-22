export const ADMIN_SECTION_GROUPS = [
  {
    id: 'catalogue',
    label: 'Catalogue',
    sections: [
      { id: 'products', label: 'Products' },
      { id: 'catalogue', label: 'Categories & Collections' }
    ]
  },
  {
    id: 'sales',
    label: 'Sales',
    sections: [
      { id: 'orders', label: 'Orders' },
      { id: 'customers', label: 'Customers' }
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    sections: [
      { id: 'inventory', label: 'Inventory' },
      { id: 'support', label: 'Support Centre' }
    ]
  },
  {
    id: 'insights',
    label: 'Insights',
    sections: [
      { id: 'analytics', label: 'Analytics' }
    ]
  }
];

export const ADMIN_STANDALONE_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', placement: 'top' },
  { id: 'settings', label: 'Settings', placement: 'bottom' }
];

export function getAdminSectionLabel(sectionId) {
  const standaloneSection = ADMIN_STANDALONE_SECTIONS.find((section) => section.id === sectionId);
  if (standaloneSection) return standaloneSection.label;

  for (const group of ADMIN_SECTION_GROUPS) {
    const section = group.sections.find((entry) => entry.id === sectionId);
    if (section) return section.label;
  }

  return 'Admin Dashboard';
}

const groupIds = ADMIN_SECTION_GROUPS.map(({ id }) => id);

export const initialAdminNavigationState = {
  isOpen: false,
  expandedGroups: Object.fromEntries(groupIds.map((id) => [id, false]))
};

const hasGroup = (state, groupId) => (
  typeof groupId === 'string'
  && Object.prototype.hasOwnProperty.call(state.expandedGroups, groupId)
);

export function adminNavigationReducer(state, action) {
  switch (action.type) {
    case 'open':
      return { ...state, isOpen: true };
    case 'close':
    case 'escape':
      return { ...state, isOpen: false };
    case 'navigate': {
      const nextState = { ...state, isOpen: false };
      if (!hasGroup(state, action.groupId)) return nextState;
      return {
        ...nextState,
        expandedGroups: { ...state.expandedGroups, [action.groupId]: true }
      };
    }
    case 'toggle':
      return { ...state, isOpen: !state.isOpen };
    case 'toggle-group':
      if (!hasGroup(state, action.groupId)) return state;
      return {
        ...state,
        expandedGroups: {
          ...state.expandedGroups,
          [action.groupId]: !state.expandedGroups[action.groupId]
        }
      };
    default:
      return state;
  }
}
