import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvironment } from '../src/config/environmentSchema.js';

const stagingEnvironment = {
  NODE_ENV: 'production',
  PORT: '10000',
  MONGODB_URI: 'mongodb+srv://staging.example.invalid/yaqana_staging',
  JWT_SECRET: 'staging-secret-that-is-long-enough-for-validation',
  FRONTEND_ORIGINS: 'https://yaqana-preview.vercel.app',
  TRUST_PROXY: 'true',
  AUTH_COOKIE_ENABLED: 'true',
  REQUIRE_MONGO_TRANSACTIONS: 'true',
  MEDIA_STORAGE: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'yaqana-staging',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'staging-cloudinary-secret-placeholder'
};

test('production configuration accepts the Vercel proxy, cookie auth and Cloudinary storage', () => {
  const config = parseEnvironment(stagingEnvironment);

  assert.equal(config.AUTH_COOKIE_ENABLED, true);
  assert.equal(config.MEDIA_STORAGE, 'cloudinary');
  assert.equal(config.allowedOrigins[0], 'https://yaqana-preview.vercel.app');
});

test('production cannot start with ephemeral local-disk image storage', () => {
  assert.throws(
    () => parseEnvironment({ ...stagingEnvironment, MEDIA_STORAGE: 'local' }),
    /production.*cloudinary/i
  );
});

test('Cloudinary storage requires all provider credentials', () => {
  assert.throws(
    () => parseEnvironment({ ...stagingEnvironment, CLOUDINARY_API_SECRET: '' }),
    /CLOUDINARY_API_SECRET/i
  );
});

test('cookie authentication cannot use an insecure staging frontend origin', () => {
  assert.throws(
    () => parseEnvironment({ ...stagingEnvironment, FRONTEND_ORIGINS: 'http://yaqana-preview.vercel.app' }),
    /HTTPS/i
  );
});
