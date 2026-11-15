import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import { createProduct, updateProduct } from '../src/controllers/catalogController.js';

const cloudinaryUrl = 'https://res.cloudinary.com/yaqana/image/upload/v1763120000/yaqana/products/yaqana-7f38a9c2e6d14b10a9ce23d4.jpg';
const legacyUrl = '/images/yaqana-products/classic-shirt.jpg';
const validId = '65f1a3b2c4d5e6f7890a1234';

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

test('creates a product with a Cloudinary secure_url in the images array', async (t) => {
  const originalCreate = Product.create;
  let createdProduct;
  Product.create = async (data) => {
    createdProduct = data;
    return data;
  };
  t.after(() => { Product.create = originalCreate; });

  const response = createResponse();
  await createProduct({
    body: {
      name: 'Cloudinary Shirt',
      description: 'A product with a durable image.',
      category: 'Shirts',
      price: 2500,
      sizes: ['M'],
      stock: 5,
      images: [cloudinaryUrl]
    }
  }, response, (error) => { throw error; });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(createdProduct.images, [cloudinaryUrl]);
  assert.deepEqual(response.body.product.images, [cloudinaryUrl]);
});

test('updates a product with a Cloudinary secure_url while preserving existing image URLs', async (t) => {
  const originalFindById = Product.findById;
  const product = {
    _id: validId,
    pricePaise: 250000,
    discountPricePaise: null,
    stock: 5,
    variants: [],
    images: [legacyUrl],
    async save() {}
  };
  Product.findById = async () => product;
  t.after(() => { Product.findById = originalFindById; });

  const response = createResponse();
  await updateProduct({
    params: { id: validId },
    body: { images: [legacyUrl, cloudinaryUrl] }
  }, response, (error) => { throw error; });

  assert.deepEqual(product.images, [legacyUrl, cloudinaryUrl]);
  assert.deepEqual(response.body.product.images, [legacyUrl, cloudinaryUrl]);
});
