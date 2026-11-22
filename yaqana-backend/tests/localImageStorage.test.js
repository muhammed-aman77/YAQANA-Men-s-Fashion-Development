import test from 'node:test';
import assert from 'node:assert/strict';

test('local image deletion only unlinks generated YAQANA upload names inside the upload directory', async () => {
  const { createLocalImageDeleter } = await import('../src/utils/localImageStorage.js');
  assert.equal(typeof createLocalImageDeleter, 'function');
  const removed = [];
  const deleteImage = createLocalImageDeleter('C:\\yaqana\\uploads', async (filePath) => { removed.push(filePath); });

  const result = await deleteImage('/uploads/yaqana-1763000000000-aabbccddeeff0011.jpg');

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(removed, ['C:\\yaqana\\uploads\\yaqana-1763000000000-aabbccddeeff0011.jpg']);
  await assert.rejects(deleteImage('/uploads/../../secrets.txt'), /not a local YAQANA product image/i);
  await assert.rejects(deleteImage('/uploads/user-upload.jpg'), /not a local YAQANA product image/i);
  assert.equal(removed.length, 1);
});

test('missing local image reports not deleted without leaking filesystem details', async () => {
  const { createLocalImageDeleter } = await import('../src/utils/localImageStorage.js');
  const deleteImage = createLocalImageDeleter('C:\\yaqana\\uploads', async () => {
    const error = new Error('file missing');
    error.code = 'ENOENT';
    throw error;
  });

  assert.deepEqual(await deleteImage('/uploads/yaqana-1763000000000-aabbccddeeff0011.webp'), { deleted: false });
});
