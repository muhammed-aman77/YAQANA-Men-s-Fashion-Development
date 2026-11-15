import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { httpError } from '../utils/http.js';
import { env } from '../config/env.js';
import { uploadBufferToCloudinary } from '../utils/cloudinaryUpload.js';
const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
export const uploadDirectory = path.resolve(here, '../../uploads');
if (env.MEDIA_STORAGE === 'local') fs.mkdirSync(uploadDirectory, { recursive: true });
const allowed = new Map([['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/avif', '.avif']]);
if (env.MEDIA_STORAGE === 'cloudinary') {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true
  });
}
const localStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => callback(null, `yaqana-${Date.now()}-${randomBytes(8).toString('hex')}${allowed.get(file.mimetype) || '.img'}`)
});
const storage = env.MEDIA_STORAGE === 'cloudinary' ? multer.memoryStorage() : localStorage;
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter(_req, file, callback) {
  if (!allowed.has(file.mimetype)) return callback(httpError(415, 'Only JPG, PNG, WebP and AVIF images are allowed.'));
  callback(null, true);
} });
function validImageSignature(mime, buffer) {
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'image/avif') return buffer.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12));
  return false;
}
router.post('/', requireAuth, requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'Please select an image file to upload.');
    const bytes = env.MEDIA_STORAGE === 'cloudinary'
      ? req.file.buffer
      : await readFile(req.file.path);
    const header = bytes.subarray(0, 16);
    if (!validImageSignature(req.file.mimetype, header)) {
      if (env.MEDIA_STORAGE === 'local') await unlink(req.file.path);
      throw httpError(415, 'The uploaded file is not a valid supported image.');
    }
    const imageUrl = env.MEDIA_STORAGE === 'cloudinary'
      ? await uploadBufferToCloudinary(req.file.buffer, cloudinary.uploader)
      : `/uploads/${req.file.filename}`;
    res.status(200).json({ success: true, message: 'Image uploaded successfully.', imageUrl });
  } catch (error) { next(error); }
});
export default router;
