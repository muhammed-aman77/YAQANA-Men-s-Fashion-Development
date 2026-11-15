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

export function createImageUploadHandler(uploadImage) {
  return async (req, res, next) => {
    try {
      if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
        throw httpError(400, 'Please select an image file to upload.');
      }
      if (!hasValidImageSignature(req.file.mimetype, req.file.buffer)) {
        throw httpError(415, 'The uploaded file is not a valid supported image.');
      }

      const imageUrl = await uploadImage(req.file.buffer);
      if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
        throw httpError(502, 'Image storage returned an invalid URL.', 'IMAGE_STORAGE_FAILED');
      }
      res.status(200).json({ success: true, message: 'Image uploaded successfully.', imageUrl });
    } catch (error) {
      next(error);
    }
  };
}
