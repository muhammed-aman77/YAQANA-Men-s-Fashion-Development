import { httpError } from './http.js';

export function isValidImageSignature(mime, buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'image/avif') return buffer.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buffer.toString('ascii', 8, 12));
  return false;
}

export function createCloudinaryImageStore(uploader, configured, folder = 'yaqana/products') {
  return async (buffer) => {
    if (!configured) throw httpError(503, 'Image storage is not configured.', 'IMAGE_STORAGE_NOT_CONFIGURED');

    try {
      return await new Promise((resolve, reject) => {
        const stream = uploader.upload_stream({
          folder,
          resource_type: 'image',
          use_filename: false,
          unique_filename: true,
          overwrite: false
        }, (error, result) => {
          if (error) return reject(error);
          if (typeof result?.secure_url !== 'string' || !result.secure_url.startsWith('https://')) {
            return reject(new Error('Cloudinary did not return a secure image URL.'));
          }
          resolve(result.secure_url);
        });
        stream.once('error', reject);
        stream.end(buffer);
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
      if (!isValidImageSignature(req.file.mimetype, req.file.buffer)) {
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
