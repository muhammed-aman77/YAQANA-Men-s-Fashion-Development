import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloudinaryImageStore,
  createImageUploadHandler,
  isValidImageSignature
} from '../src/utils/cloudinaryUpload.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const secureUrl = 'https://res.cloudinary.com/yaqana/image/upload/v1/yaqana/products/photo.jpg';

function createUploader(callbackForBuffer) {
  let uploadOptions;
  const uploader = {
    upload_stream(options, callback) {
      uploadOptions = options;
      return {
        once() { return this; },
        end(buffer) { callbackForBuffer(buffer, callback); }
      };
    }
  };
  return { uploader, getUploadOptions: () => uploadOptions };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('uploads a validated image and returns Cloudinary secure_url', async () => {
  let uploadedBuffer;
  const { uploader, getUploadOptions } = createUploader((buffer, callback) => {
    uploadedBuffer = buffer;
    callback(null, { secure_url: secureUrl });
  });
  const storeImage = createCloudinaryImageStore(uploader, true);
  const handler = createImageUploadHandler(storeImage);
  const response = createResponse();
  const errors = [];

  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' } }, response, (error) => errors.push(error));

  assert.deepEqual(errors, []);
  assert.equal(uploadedBuffer, jpeg);
  assert.equal(getUploadOptions().folder, 'yaqana/products');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.imageUrl, secureUrl);
});

test('reports Cloudinary upload failures without returning a successful response', async () => {
  const providerError = new Error('provider unavailable');
  const { uploader } = createUploader((_buffer, callback) => callback(providerError));
  const storeImage = createCloudinaryImageStore(uploader, true);
  const handler = createImageUploadHandler(storeImage);
  const response = createResponse();
  const errors = [];

  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' } }, response, (error) => errors.push(error));

  assert.equal(response.statusCode, null);
  assert.equal(response.body, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].statusCode, 502);
  assert.equal(errors[0].code, 'IMAGE_STORAGE_FAILED');
});

test('rejects uploads when Cloudinary is not configured', async () => {
  let uploadStarted = false;
  const { uploader } = createUploader(() => { uploadStarted = true; });
  const storeImage = createCloudinaryImageStore(uploader, false);

  await assert.rejects(storeImage(jpeg), {
    statusCode: 503,
    code: 'IMAGE_STORAGE_NOT_CONFIGURED'
  });
  assert.equal(uploadStarted, false);
});

test('rejects a signature mismatch before sending the buffer to Cloudinary', async () => {
  let uploadStarted = false;
  const { uploader } = createUploader(() => { uploadStarted = true; });
  const handler = createImageUploadHandler(createCloudinaryImageStore(uploader, true));
  const response = createResponse();
  const errors = [];

  await handler({ file: { buffer: Buffer.from('not an image'), mimetype: 'image/jpeg' } }, response, (error) => errors.push(error));

  assert.equal(uploadStarted, false);
  assert.equal(response.statusCode, null);
  assert.equal(errors[0].statusCode, 415);
  assert.equal(isValidImageSignature('image/jpeg', jpeg), true);
});

test('recognizes the supported image file signatures', () => {
  const validImages = [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/webp', Buffer.from('RIFF0000WEBP', 'ascii')],
    ['image/avif', Buffer.from('0000ftypavif', 'ascii')],
    ['image/avif', Buffer.from('0000ftypavis', 'ascii')]
  ];

  for (const [mime, buffer] of validImages) assert.equal(isValidImageSignature(mime, buffer), true);
  assert.equal(isValidImageSignature('image/gif', Buffer.from('GIF89a')), false);
});
