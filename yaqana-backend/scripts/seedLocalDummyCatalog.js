import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Category from '../src/models/Category.js';
import Collection from '../src/models/Collection.js';
import Product from '../src/models/Product.js';
import { mongoSeedHosts } from '../src/utils/dummyCatalogSeed.js';
import { seedLocalDummyCatalog, validateLocalDummyCatalogTarget } from '../src/utils/localDummyCatalogSeed.js';

const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_MONGODB_URI = `mongodb://127.0.0.1:27017/${LOCAL_DATABASE}`;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '..');
const workspaceDirectory = path.resolve(backendDirectory, '..');
const products = JSON.parse(readFileSync(path.join(backendDirectory, 'data', 'dev-products.json'), 'utf8'));
const imageManifestPath = path.join(workspaceDirectory, 'frontend', 'public', 'images', 'dev-products', 'manifest.json');
const imageDirectory = path.dirname(imageManifestPath);
const imageManifest = JSON.parse(readFileSync(imageManifestPath, 'utf8'));
const categories = [
  { name: 'T-Shirts', slug: 't-shirts', image: '/images/yaqana-categories/t-shirt.jpeg', gender: 'men', active: true },
  { name: 'Shirts', slug: 'shirts', image: '/images/yaqana-categories/shirt.jpeg', gender: 'men', active: true },
  { name: 'Trousers', slug: 'trousers', image: '/images/yaqana-categories/trouser.jpeg', gender: 'men', active: true },
  { name: 'Jeans', slug: 'jeans', image: '/images/dev-products/dev-dummy-indigo-straight-jean.jpg', gender: 'men', active: true },
  { name: 'Hoodies', slug: 'hoodies', image: '/images/yaqana-categories/hoodie%20(1).jpeg', gender: 'men', active: true },
  { name: 'Jackets', slug: 'jackets', image: '/images/dev-products/dev-dummy-cotton-twill-utility-jacket.jpg', gender: 'men', active: true }
];
const collections = [
  {
    name: 'DEV SAMPLE — Everyday Essentials',
    slug: 'dev-sample-everyday-essentials',
    description: 'Development sample collection; product content is illustrative.',
    active: true
  },
  {
    name: 'DEV SAMPLE — Modern Tailoring',
    slug: 'dev-sample-modern-tailoring',
    description: 'Development sample collection; product content is illustrative.',
    active: true
  },
  {
    name: 'DEV SAMPLE — Weekend Layers',
    slug: 'dev-sample-weekend-layers',
    description: 'Development sample collection; product content is illustrative.',
    active: true
  }
];

const confirmations = process.argv.filter((argument) => argument.startsWith('--confirm-local-database='));
const confirmation = confirmations.length === 1
  ? confirmations[0].slice('--confirm-local-database='.length)
  : undefined;
const target = {
  nodeEnvironment: process.env.NODE_ENV,
  databaseName: LOCAL_DATABASE,
  hosts: ['127.0.0.1:27017'],
  confirmation
};

if (confirmations.length > 1) throw new Error('Provide exactly one local database confirmation.');
if (process.env.MONGODB_URI && process.env.MONGODB_URI !== LOCAL_MONGODB_URI) {
  throw new Error('MONGODB_URI must be unset or exactly match the dedicated local development URI.');
}
validateLocalDummyCatalogTarget(target);

if (products.length !== 24 || imageManifest.length !== 24) {
  throw new Error('The seed requires exactly 24 products and 24 image-manifest entries.');
}
const manifestBySlug = new Map(imageManifest.map((entry) => [entry.productSlug, entry]));
if (manifestBySlug.size !== imageManifest.length) throw new Error('The image manifest contains duplicate product slugs.');
for (const product of products) {
  const image = manifestBySlug.get(product.slug);
  if (!image || product.images.length !== 1 || image.publicPath !== product.images[0]) {
    throw new Error(`The image manifest does not match product "${product.slug}".`);
  }
  const bytes = readFileSync(path.join(imageDirectory, image.file));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== image.sha256) throw new Error(`The local image hash does not match the manifest for "${product.slug}".`);
}

const productsByCategory = new Map();
for (const product of products) {
  productsByCategory.set(product.category, (productsByCategory.get(product.category) || 0) + 1);
}
if (categories.length !== 6 || categories.some(({ name }) => productsByCategory.get(name) !== 4)) {
  throw new Error('The original catalogue must contain four products in each of the six expected categories.');
}

try {
  await mongoose.connect(LOCAL_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const client = mongoose.connection.getClient();
  const connectedTarget = {
    nodeEnvironment: process.env.NODE_ENV,
    databaseName: mongoose.connection.name,
    hosts: mongoSeedHosts(client),
    confirmation
  };
  validateLocalDummyCatalogTarget(connectedTarget);

  const before = await Product.countDocuments({});
  process.stdout.write(`Verified local target only: database=${connectedTarget.databaseName}; host=127.0.0.1:27017; totalProductsBefore=${before}.\n`);
  const summary = await seedLocalDummyCatalog({
    target: connectedTarget,
    Category,
    Collection,
    Product,
    categories,
    collections,
    products
  });

  const [totalProducts, seededProducts, categoryCounts] = await Promise.all([
    Product.countDocuments({}),
    Product.countDocuments({ slug: { $in: products.map(({ slug }) => slug) } }),
    Promise.all(categories.map(async ({ name }) => ({
      category: name,
      count: await Product.countDocuments({ category: name, slug: { $in: products.map(({ slug }) => slug) } })
    })))
  ]);
  if (seededProducts !== 24 || categoryCounts.some(({ count }) => count !== 4)) {
    throw new Error(`Post-seed verification failed: seeded=${seededProducts}; categories=${JSON.stringify(categoryCounts)}.`);
  }
  process.stdout.write(`Insert-only seed summary: ${JSON.stringify(summary)}\n`);
  process.stdout.write(`Verified product counts: total=${totalProducts}; originalCatalogue=${seededProducts}; byCategory=${JSON.stringify(categoryCounts)}.\n`);
} finally {
  await mongoose.disconnect();
}
