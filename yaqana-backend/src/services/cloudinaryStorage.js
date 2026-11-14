import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { createCloudinaryImageStore } from '../utils/cloudinaryUpload.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true
});

export const uploadProductImage = createCloudinaryImageStore(cloudinary.uploader, env.cloudinaryConfigured);
