export const initialAdminNavigationState = { isOpen: false };

export function adminNavigationReducer(state, action) {
  switch (action.type) {
    case 'open':
      return { isOpen: true };
    case 'close':
    case 'escape':
    case 'navigate':
      return { isOpen: false };
    case 'toggle':
      return { isOpen: !state.isOpen };
    default:
      return state;
  }
}
