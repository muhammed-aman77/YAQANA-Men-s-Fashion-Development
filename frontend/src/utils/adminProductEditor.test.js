import test from 'node:test';
import assert from 'node:assert/strict';
import { adminProductEditorReducer, initialProductEditorState } from './adminProductEditor.js';

test('opening the create editor clears edit context and opens the dialog', () => {
  const editingState = { isOpen: true, editingId: 'product-1' };

  assert.deepEqual(
    adminProductEditorReducer(editingState, { type: 'create' }),
    { isOpen: true, editingId: null }
  );
});

test('opening an existing product editor retains the selected product id', () => {
  assert.deepEqual(
    adminProductEditorReducer(initialProductEditorState, { type: 'edit', productId: 'product-2' }),
    { isOpen: true, editingId: 'product-2' }
  );
});

test('closing the product editor clears its open and edit state', () => {
  assert.deepEqual(
    adminProductEditorReducer({ isOpen: true, editingId: 'product-2' }, { type: 'close' }),
    initialProductEditorState
  );
});
