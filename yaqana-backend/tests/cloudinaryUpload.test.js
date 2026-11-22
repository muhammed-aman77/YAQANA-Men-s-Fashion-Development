import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloudinaryImageStore,
  createImageUploadHandler,
  deleteCloudinaryImageUrl,
  isValidImageSignature,
  uploadBufferToCloudinary
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

test('legacy Cloudinary upload returns a secure URL and keeps the product media policy', async () => {
  const buffer = Buffer.from('image bytes');
  const { uploader, getUploadOptions } = createUploader((uploadedBuffer, callback) => {
    assert.equal(uploadedBuffer, buffer);
    callback(null, { secure_url: secureUrl });
  });

  assert.equal(await uploadBufferToCloudinary(buffer, uploader), secureUrl);
  assert.equal(getUploadOptions().folder, 'yaqana/products');
  assert.equal(getUploadOptions().resource_type, 'image');
  assert.deepEqual(getUploadOptions().allowed_formats, ['jpg', 'jpeg', 'png', 'webp', 'avif']);
});

test('legacy Cloudinary upload surfaces provider errors and rejects insecure responses', async () => {
  const failed = createUploader((_buffer, callback) => callback(new Error('Cloudinary unavailable')));
  await assert.rejects(uploadBufferToCloudinary(jpeg, failed.uploader), /Cloudinary unavailable/);

  const insecure = createUploader((_buffer, callback) => callback(null, { url: 'http://insecure.example/image.jpg' }));
  await assert.rejects(uploadBufferToCloudinary(jpeg, insecure.uploader), /secure URL/);
});

test('uploads a validated image and returns Cloudinary secure_url', async () => {
  let uploadedBuffer;
  const { uploader, getUploadOptions } = createUploader((buffer, callback) => {
    uploadedBuffer = buffer;
    callback(null, { secure_url: secureUrl });
  });
  const handler = createImageUploadHandler(createCloudinaryImageStore(uploader, true));
  const response = createResponse();
  const errors = [];

  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' } }, response, (error) => errors.push(error));

  assert.deepEqual(errors, []);
  assert.equal(uploadedBuffer, jpeg);
  assert.equal(getUploadOptions().folder, 'yaqana/products');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.imageUrl, secureUrl);
});

test('audited image upload persists an intent before storage and a hashed completion after storage', async () => {
  const audits = [];
  let stored = false;
  const auditModel = { async create(record) { audits.push(record); } };
  const handler = createImageUploadHandler(async () => { stored = true; return secureUrl; }, { auditModel });
  const response = createResponse();
  const errors = [];
  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' }, user: { _id: 'admin-1' } }, response, (error) => errors.push(error));

  assert.deepEqual(errors, []);
  assert.equal(stored, true);
  assert.equal(audits[0].action, 'catalog.image.upload.started');
  assert.equal(audits[0].actor, 'admin-1');
  assert.equal(audits[0].metadata.phase, 'intent');
  assert.equal(audits[1].action, 'catalog.image.upload');
  assert.equal(audits[1].metadata.phase, 'completed');
  assert.equal(audits[1].after.referenceHash.length, 64);
  assert.equal(JSON.stringify(audits).includes(secureUrl), false);
});

test('image upload does not contact storage when its audit intent cannot be saved', async () => {
  let storageCalled = false;
  const auditModel = { async create() { throw new Error('audit unavailable'); } };
  const handler = createImageUploadHandler(async () => { storageCalled = true; return secureUrl; }, { auditModel });
  const errors = [];
  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' }, user: { _id: 'admin-1' } }, createResponse(), (error) => errors.push(error));
  assert.equal(storageCalled, false);
  assert.match(errors[0].message, /audit unavailable/);
});

test('compensates an uploaded image when the completion audit fails', async () => {
  const audits = [];
  let completed = false;
  let deletedUrl;
  const handler = createImageUploadHandler(async () => secureUrl, {
    deleteImage: async (url) => { deletedUrl = url; return { deleted: true }; },
    auditModel: { async create(record) {
      if (record.metadata.phase === 'completed') throw new Error('audit completion unavailable');
      audits.push(record);
      completed = true;
    } }
  });
  const errors = [];

  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' }, user: { _id: 'admin-1' } }, createResponse(), (error) => errors.push(error));

  assert.equal(completed, true);
  assert.equal(deletedUrl, secureUrl);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /could not be audited/i);
  assert.equal(errors[0].message.includes(secureUrl), false);
  assert.equal(audits[1].action, 'catalog.image.upload.compensated');
  assert.equal(audits[1].metadata.phase, 'compensated');
  assert.equal(audits[1].metadata.targetId.length, 64);
  assert.equal(JSON.stringify(audits).includes(secureUrl), false);
});

test('records reconciliation when image compensation fails after completion audit failure', async () => {
  const audits = [];
  const handler = createImageUploadHandler(async () => secureUrl, {
    deleteImage: async () => { throw new Error('delete unavailable'); },
    auditModel: { async create(record) {
      if (record.metadata.phase === 'completed') throw new Error('audit completion unavailable');
      audits.push(record);
    } }
  });
  const errors = [];

  await handler({ file: { buffer: jpeg, mimetype: 'image/jpeg' }, user: { _id: 'admin-1' } }, createResponse(), (error) => errors.push(error));

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'IMAGE_UPLOAD_AUDIT_COMPLETION_FAILED');
  assert.match(errors[0].message, /reconciliation/i);
  assert.equal(audits[1].action, 'catalog.image.upload.reconciliation_required');
  assert.equal(audits[1].metadata.phase, 'reconciliation_required');
  assert.equal(audits[1].metadata.targetId.length, 64);
  assert.equal(JSON.stringify(audits).includes(secureUrl), false);
});

test('audited image deletion records intent before delete and never stores the image URL', async () => {
  const { createImageDeleteHandler } = await import('../src/utils/cloudinaryUpload.js');
  assert.equal(typeof createImageDeleteHandler, 'function');
  const audits = [];
  let deletionCalled = false;
  const handler = createImageDeleteHandler(async () => { deletionCalled = true; return { deleted: true }; }, {
    auditModel: { async create(record) { audits.push(record); } }
  });
  const response = createResponse();
  const errors = [];
  await handler({ body: { imageUrl: secureUrl }, user: { _id: 'admin-2' } }, response, (error) => errors.push(error));
  assert.deepEqual(errors, []);
  assert.equal(deletionCalled, true);
  assert.equal(audits[0].action, 'catalog.image.delete.started');
  assert.equal(audits[0].actor, 'admin-2');
  assert.equal(audits[0].before.referenceHash.length, 64);
  assert.equal(audits[1].action, 'catalog.image.delete');
  assert.equal(JSON.stringify(audits).includes(secureUrl), false);
});

test('reports Cloudinary upload failures without returning a successful response', async () => {
  const { uploader } = createUploader((_buffer, callback) => callback(new Error('provider unavailable')));
  const handler = createImageUploadHandler(createCloudinaryImageStore(uploader, true));
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

test('deletes only Cloudinary product assets and rejects unrelated URLs', async () => {
  const calls = [];
  const uploader = {
    destroy(publicId, options, callback) {
      calls.push([publicId, options]);
      callback(null, { result: 'ok' });
    }
  };

  await deleteCloudinaryImageUrl(
    'https://res.cloudinary.com/yaqana/image/upload/v1763120000/yaqana/products/photo.jpg',
    uploader
  );

  assert.deepEqual(calls, [[
    'yaqana/products/photo',
    { resource_type: 'image', invalidate: true }
  ]]);
  await assert.rejects(
    deleteCloudinaryImageUrl('https://example.test/photo.jpg', uploader),
    /not a Cloudinary product image/i
  );
});
