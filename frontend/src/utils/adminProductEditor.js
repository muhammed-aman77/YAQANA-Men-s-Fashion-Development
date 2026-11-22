export const initialProductEditorState = {
  isOpen: false,
  editingId: null
};

export function adminProductEditorReducer(state, action) {
  switch (action.type) {
    case 'create':
      return { isOpen: true, editingId: null };
    case 'edit':
      return { isOpen: true, editingId: action.productId };
    case 'close':
      return initialProductEditorState;
    default:
      return state;
  }
}
