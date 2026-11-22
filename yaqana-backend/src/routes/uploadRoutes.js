import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import AdminAudit from '../models/AdminAudit.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { httpError } from '../utils/http.js';
import { createImageDeleteHandler, createImageUploadHandler } from '../utils/cloudinaryUpload.js';
import { createLocalImageDeleter } from '../utils/localImageStorage.js';
import { deleteProductImage, uploadProductImage } from '../services/cloudinaryStorage.js';

const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
export const uploadDirectory = path.resolve(here, '../../uploads');
const allowed = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif']
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!allowed.has(file.mimetype)) {
      return callback(httpError(415, 'Only JPG, PNG, WebP and AVIF images are allowed.'));
    }
    callback(null, true);
  }
});

async function saveLocalImage(file) {
  const filename = `yaqana-${Date.now()}-${randomBytes(8).toString('hex')}${allowed.get(file.mimetype)}`;
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

const uploadImage = env.MEDIA_STORAGE === 'cloudinary'
  ? (buffer) => uploadProductImage(buffer)
  : (_buffer, file) => saveLocalImage(file);
const deleteImage = env.MEDIA_STORAGE === 'cloudinary'
  ? deleteProductImage
  : createLocalImageDeleter(uploadDirectory);
router.post('/', requireAuth, requireAdmin, upload.single('image'), createImageUploadHandler(uploadImage, { auditModel: AdminAudit, deleteImage }));
router.delete('/', requireAuth, requireAdmin, createImageDeleteHandler(deleteImage, { auditModel: AdminAudit }));

export default router;
