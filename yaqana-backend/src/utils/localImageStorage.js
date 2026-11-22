import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { httpError } from './http.js';

const LOCAL_IMAGE_NAME = /^yaqana-\d+-[a-f0-9]{16}\.(?:jpg|png|webp|avif)$/i;

export function createLocalImageDeleter(directory, unlinkFile = unlink) {
  const uploadRoot = path.resolve(directory);
  return async (imageUrl) => {
    const match = typeof imageUrl === 'string' && /^\/uploads\/([^/]+)$/.exec(imageUrl);
    if (!match || !LOCAL_IMAGE_NAME.test(match[1])) {
      throw httpError(400, 'The image is not a local YAQANA product image.', 'INVALID_LOCAL_PRODUCT_IMAGE');
    }
    const filePath = path.resolve(uploadRoot, match[1]);
    if (path.dirname(filePath) !== uploadRoot) {
      throw httpError(400, 'The image is not a local YAQANA product image.', 'INVALID_LOCAL_PRODUCT_IMAGE');
    }
    try {
      await unlinkFile(filePath);
      return { deleted: true };
    } catch (error) {
      if (error?.code === 'ENOENT') return { deleted: false };
      throw httpError(500, 'The local product image could not be deleted.', 'LOCAL_IMAGE_DELETE_FAILED');
    }
  };
}
