import test from 'node:test';
import assert from 'node:assert/strict';
import Cart from '../src/models/Cart.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';

const productId = '64b000000000000000000001';
const product = {
  _id: productId,
  name: 'YAQANA Mock Tee',
  category: 'T-Shirts',
  gender: 'men',
  active: true,
  pricePaise: 830000,
  discountPricePaise: 747000,
  sizes: ['M'],
  colours: [{ name: 'Sand', images: ['/images/sand-tee.jpg'] }],
  variants: [{ size: 'M', colour: 'Sand', sku: 'YAQ-TEE-SND-M', stock: 4 }],
  images: ['/images/tee.jpg'],
  stock: 4
};

async function loadQuoteController() {
  const module = await import('../src/controllers/orderController.js');
  assert.equal(typeof module.quoteOrder, 'function', 'quoteOrder should be exported');
  return module.quoteOrder;
}

async function invoke(handler, req) {
  const response = {
    statusCode: 200,
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
  let forwardedError;
  await handler(req, response, (error) => { forwardedError = error; });
  return { response, error: forwardedError };
}

test('quote controller returns a signed quote from product reads only', async (t) => {
  const quoteOrder = await loadQuoteController();
  const writeCalls = [];
  const findMock = t.mock.method(Product, 'find', () => ({
    lean: async () => [product]
  }));
  t.mock.method(Product, 'updateOne', () => writeCalls.push('product update'));
  t.mock.method(Product, 'findOneAndUpdate', () => writeCalls.push('stock update'));
  t.mock.method(Cart, 'findOneAndUpdate', () => writeCalls.push('cart update'));
  t.mock.method(Order, 'create', () => writeCalls.push('order create'));
  t.mock.method(StockMovement, 'create', () => writeCalls.push('stock movement'));

  const { response, error } = await invoke(quoteOrder, {
    user: { _id: 'customer-1' },
    body: { items: [{ productId, quantity: 2, size: 'M', colour: 'Sand' }] }
  });

  assert.equal(error, undefined);
  assert.equal(findMock.mock.callCount(), 1);
  assert.equal(response.body.success, true);
  assert.equal(response.body.quote.lines[0].price, 90);
  assert.equal(response.body.quote.lines[0].originalPrice, 100);
  assert.equal(response.body.quote.discount, 20);
  assert.equal(response.body.quote.total, 209.4);
  assert.equal(typeof response.body.quoteToken, 'string');
  assert.deepEqual(writeCalls, []);
});

test('quote controller rejects a request without valid item details', async () => {
  const quoteOrder = await loadQuoteController();
  const { error } = await invoke(quoteOrder, {
    user: { _id: 'customer-1' },
    body: { items: [] }
  });

  assert.equal(error?.statusCode, 400);
});
