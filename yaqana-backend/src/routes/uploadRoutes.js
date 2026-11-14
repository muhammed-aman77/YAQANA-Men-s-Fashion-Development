import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { httpError } from '../utils/http.js';
import { createImageUploadHandler } from '../utils/cloudinaryUpload.js';
import { uploadProductImage } from '../services/cloudinaryStorage.js';
const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
export const uploadDirectory = path.resolve(here, '../../uploads');
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter(_req, file, callback) {
  if (!allowed.has(file.mimetype)) return callback(httpError(415, 'Only JPG, PNG, WebP and AVIF images are allowed.'));
  callback(null, true);
} });
router.post('/', requireAuth, requireAdmin, upload.single('image'), createImageUploadHandler(uploadProductImage));
export default router;
