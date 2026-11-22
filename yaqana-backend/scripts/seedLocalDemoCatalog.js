import { createLocalDemoScriptEnvironment } from '../src/config/localDevelopmentEnvironment.js';

const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_URI = `mongodb://127.0.0.1:27017/${LOCAL_DATABASE}`;
Object.assign(process.env, createLocalDemoScriptEnvironment(process.env));

const [{ default: mongoose }, { default: Category }, { default: Collection }, { default: Product }, fixtureModule, seedModule] =
  await Promise.all([
    import('mongoose'),
    import('../src/models/Category.js'),
    import('../src/models/Collection.js'),
    import('../src/models/Product.js'),
    import('../src/utils/demoCatalogFixture.js'),
    import('../src/utils/demoCatalogSeed.js')
  ]);

const { buildDemoCatalogFixture } = fixtureModule;
const { seedDemoCatalog } = seedModule;
const apply = process.argv.includes('--apply');
const confirmationArgs = process.argv.filter((argument) => argument.startsWith('--confirm-local-database='));
const confirmation = confirmationArgs.length === 1
  ? confirmationArgs[0].slice('--confirm-local-database='.length)
  : undefined;

await mongoose.connect(LOCAL_URI, { serverSelectionTimeoutMS: 10000 });
try {
  const hosts = [...mongoose.connection.getClient().topology.description.servers.keys()];
  const target = {
    nodeEnvironment: 'development',
    databaseName: mongoose.connection.name,
    hosts,
    confirmation
  };
  const fixture = buildDemoCatalogFixture();
  const catalogSummary = apply
    ? await seedDemoCatalog({ target, Category, Collection, Product, ...fixture })
    : null;

  const counts = {
    categories: fixture.categories.length,
    collections: fixture.collections.length,
    products: fixture.products.length,
    variants: fixture.products.reduce((sum, product) => sum + product.variants.length, 0),
    demoStock: fixture.products.reduce((sum, product) => sum + product.stock, 0)
  };
  process.stdout.write(`${JSON.stringify({ apply, database: mongoose.connection.name, projectedOrApplied: counts, result: catalogSummary }, null, 2)}\n`);
  if (!apply) process.stdout.write('Dry run only. Pass --apply --confirm-local-database=yaqana_local_dev_20261115 to write missing demo records.\n');
} finally {
  await mongoose.disconnect();
}
