const CLOUDINARY_FOLDER = 'yaqana/products';
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

export function uploadBufferToCloudinary(buffer, uploader) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new Error('Cloudinary upload requires a non-empty image buffer.'));
  }
  if (!uploader || typeof uploader.upload_stream !== 'function') {
    return Promise.reject(new Error('Cloudinary image storage is not configured.'));
  }

  return new Promise((resolve, reject) => {
    const stream = uploader.upload_stream({
      folder: CLOUDINARY_FOLDER,
      resource_type: 'image',
      allowed_formats: ALLOWED_FORMATS,
      unique_filename: true,
      overwrite: false
    }, (error, result) => {
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
    stream.end(buffer);
  });
}
