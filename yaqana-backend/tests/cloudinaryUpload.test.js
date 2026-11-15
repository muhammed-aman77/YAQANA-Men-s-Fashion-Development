import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadBufferToCloudinary } from '../src/utils/cloudinaryUpload.js';

test('Cloudinary upload returns the secure hosted URL and uses the product media policy', async () => {
  const buffer = Buffer.from('image bytes');
  let receivedOptions;
  const uploader = {
    upload_stream(options, callback) {
      receivedOptions = options;
      return {
        end(uploadedBuffer) {
          assert.equal(uploadedBuffer, buffer);
          callback(null, { secure_url: 'https://res.cloudinary.com/yaqana/image/upload/product.jpg' });
        }
      };
    }
  };

  const url = await uploadBufferToCloudinary(buffer, uploader);

  assert.equal(url, 'https://res.cloudinary.com/yaqana/image/upload/product.jpg');
  assert.equal(receivedOptions.folder, 'yaqana/products');
  assert.equal(receivedOptions.resource_type, 'image');
  assert.deepEqual(receivedOptions.allowed_formats, ['jpg', 'jpeg', 'png', 'webp', 'avif']);
});

test('Cloudinary upload failures are surfaced instead of returning a local-looking success URL', async () => {
  const uploader = {
    upload_stream(_options, callback) {
      return { end() { callback(new Error('Cloudinary unavailable')); } };
    }
  };

  await assert.rejects(uploadBufferToCloudinary(Buffer.from('image'), uploader), /Cloudinary unavailable/);
});

test('Cloudinary upload rejects responses without a secure URL', async () => {
  const uploader = {
    upload_stream(_options, callback) {
      return { end() { callback(null, { url: 'http://insecure.example/image.jpg' }); } };
    }
  };

  await assert.rejects(uploadBufferToCloudinary(Buffer.from('image'), uploader), /secure URL/);
});
