import { createHash } from 'node:crypto';
import { httpError } from './http.js';

const CLOUDINARY_FOLDER = 'yaqana/products';
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

function hasValidImageSignature(mime, buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'image/avif') return buffer.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12));
  return false;
}

function uploadBuffer(buffer, uploader, options) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new Error('Cloudinary upload requires a non-empty image buffer.'));
  }
  if (!uploader || typeof uploader.upload_stream !== 'function') {
    return Promise.reject(new Error('Cloudinary image storage is not configured.'));
  }

  return new Promise((resolve, reject) => {
    const stream = uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      if (typeof result?.secure_url !== 'string' || !result.secure_url.startsWith('https://')) {
        reject(new Error('Cloudinary did not return a secure URL.'));
        return;
      }
      resolve(result.secure_url);
    });
    if (typeof stream?.once === 'function') stream.once('error', reject);
    stream.end(buffer);
  });
}

export function uploadBufferToCloudinary(buffer, uploader) {
  return uploadBuffer(buffer, uploader, {
    folder: CLOUDINARY_FOLDER,
    resource_type: 'image',
    allowed_formats: ALLOWED_FORMATS,
    unique_filename: true,
    overwrite: false
  });
}

export function isValidImageSignature(mime, buffer) {
  return hasValidImageSignature(mime, buffer);
}

export function createCloudinaryImageStore(uploader, configured, folder = CLOUDINARY_FOLDER) {
  return async (buffer) => {
    if (!configured) throw httpError(503, 'Image storage is not configured.', 'IMAGE_STORAGE_NOT_CONFIGURED');

    try {
      return await uploadBuffer(buffer, uploader, {
        folder,
        resource_type: 'image',
        allowed_formats: ALLOWED_FORMATS,
        use_filename: false,
        unique_filename: true,
        overwrite: false
      });
    } catch (error) {
      const storageError = httpError(502, 'Image storage failed. Please try again.', 'IMAGE_STORAGE_FAILED');
      storageError.cause = error;
      throw storageError;
    }
  };
}

export async function deleteCloudinaryImageUrl(imageUrl, uploader) {
  if (typeof imageUrl !== 'string') {
    throw httpError(400, 'A product image URL is required.');
  }
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw httpError(400, 'The product image URL is invalid.');
  }
  if (!/^res\.cloudinary\.com$/i.test(parsed.hostname) || !/^\/[^/]+\/image\/upload\/(?:[^/]+\/)*yaqana\/products\/[^/]+$/i.test(parsed.pathname)) {
    throw httpError(400, 'The URL is not a Cloudinary product image.', 'INVALID_CLOUDINARY_PRODUCT_URL');
  }
  if (!uploader || typeof uploader.destroy !== 'function') {
    throw httpError(503, 'Cloudinary deletion is not configured.', 'IMAGE_STORAGE_NOT_CONFIGURED');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const uploadIndex = segments.findIndex((segment) => segment === 'upload');
  const assetSegments = segments.slice(uploadIndex + 1);
  if (assetSegments[0]?.startsWith('v') && /^\d+$/.test(assetSegments[0].slice(1))) assetSegments.shift();
  const publicIdWithExtension = assetSegments.join('/');
  const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, '');
  if (!publicId.startsWith(`${CLOUDINARY_FOLDER}/`)) {
    throw httpError(400, 'The URL is not a Cloudinary product image.', 'INVALID_CLOUDINARY_PRODUCT_URL');
  }

  const result = await new Promise((resolve, reject) => {
    uploader.destroy(publicId, { resource_type: 'image', invalidate: true }, (error, deletion) => {
      if (error) reject(error);
      else resolve(deletion);
    });
  });
  if (!result || result.result === 'not found') return { deleted: false, publicId };
  return { deleted: true, publicId };
}

function imageReferenceHash(imageUrl) {
  return createHash('sha256').update(String(imageUrl)).digest('hex');
}

async function recordImageAudit(auditModel, req, { action, phase, before, after, referenceHash = null }) {
  if (!auditModel) return;
  if (!req.user?._id) throw httpError(401, 'Administrator identity is required for image changes.');
  await auditModel.create({
    actor: req.user._id,
    action: phase === 'intent' ? `${action}.started` : action,
    reason: action === 'catalog.image.upload'
      ? phase === 'intent' ? 'Administrator started a catalog image upload.' : 'Administrator uploaded a catalog image.'
      : action === 'catalog.image.upload.compensated'
        ? 'Catalog image upload was removed after its completion audit failed.'
        : action === 'catalog.image.upload.reconciliation_required'
          ? 'Catalog image upload requires reconciliation after completion audit and cleanup failed.'
          : phase === 'intent' ? 'Administrator started a catalog image deletion.' : 'Administrator deleted a catalog image.',
    before,
    after,
    metadata: { targetType: 'catalog_image', targetId: referenceHash, phase }
  });
}

export function createImageUploadHandler(uploadImage, { auditModel = null, deleteImage = null } = {}) {
  return async (req, res, next) => {
    try {
      if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
        throw httpError(400, 'Please select an image file to upload.');
      }
      if (!hasValidImageSignature(req.file.mimetype, req.file.buffer)) {
        throw httpError(415, 'The uploaded file is not a valid supported image.');
      }

      await recordImageAudit(auditModel, req, {
        action: 'catalog.image.upload', phase: 'intent', before: { present: false }, after: { present: true }
      });
      const imageUrl = await uploadImage(req.file.buffer, req.file);
      if (typeof imageUrl !== 'string' || !(imageUrl.startsWith('https://') || (imageUrl.startsWith('/uploads/') && !imageUrl.startsWith('//')))) {
        throw httpError(502, 'Image storage returned an invalid URL.', 'IMAGE_STORAGE_FAILED');
      }
      const referenceHash = imageReferenceHash(imageUrl);
      try {
        await recordImageAudit(auditModel, req, {
          action: 'catalog.image.upload', phase: 'completed', before: { present: false },
          after: { present: true, referenceHash }, referenceHash
        });
      } catch {
        let cleanupSucceeded = false;
        try {
          if (typeof deleteImage !== 'function') throw new Error('Image cleanup is not configured.');
          await deleteImage(imageUrl);
          cleanupSucceeded = true;
        } catch {
          // The original upload intent remains as the durable record of the incomplete operation.
        }

        try {
          const phase = cleanupSucceeded ? 'compensated' : 'reconciliation_required';
          await recordImageAudit(auditModel, req, {
            action: cleanupSucceeded ? 'catalog.image.upload.compensated' : 'catalog.image.upload.reconciliation_required',
            phase, before: { present: true, referenceHash }, after: { present: !cleanupSucceeded, referenceHash }, referenceHash
          });
        } catch {
          // Keep returning a sanitized failure even when the follow-up audit cannot be persisted.
        }

        throw httpError(503,
          cleanupSucceeded
            ? 'Image upload completion could not be audited; the uploaded image was removed.'
            : 'Image upload completion could not be audited and cleanup failed; reconciliation is required.',
          'IMAGE_UPLOAD_AUDIT_COMPLETION_FAILED');
      }
      res.status(200).json({ success: true, message: 'Image uploaded successfully.', imageUrl });
    } catch (error) {
      next(error);
    }
  };
}

export function createImageDeleteHandler(deleteImage, { auditModel = null } = {}) {
  return async (req, res, next) => {
    try {
      const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : '';
      const referenceHash = imageReferenceHash(imageUrl);
      await recordImageAudit(auditModel, req, {
        action: 'catalog.image.delete', phase: 'intent', before: { present: true, referenceHash }, after: { present: false }, referenceHash
      });
      const result = await deleteImage(imageUrl);
      await recordImageAudit(auditModel, req, {
        action: 'catalog.image.delete', phase: 'completed', before: { present: true, referenceHash }, after: { present: false }, referenceHash
      });
      res.status(200).json({ success: true, message: 'Product image deleted.', ...result });
    } catch (error) {
      next(error);
    }
  };
}
