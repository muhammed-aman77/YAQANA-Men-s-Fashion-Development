const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_HOST = '127.0.0.1:27017';

export function validateDemoCatalogTarget({
  nodeEnvironment,
  databaseName,
  hosts,
  confirmation
}) {
  if (nodeEnvironment !== 'development') {
    throw new Error('Demo catalogue operations require NODE_ENV=development.');
  }
  if (databaseName !== LOCAL_DATABASE) {
    throw new Error(`Demo catalogue operations require database "${LOCAL_DATABASE}".`);
  }
  if (confirmation !== LOCAL_DATABASE) {
    throw new Error(`Pass --confirm-local-database=${LOCAL_DATABASE} to continue.`);
  }
  if (!Array.isArray(hosts) || hosts.length !== 1 || hosts[0] !== LOCAL_HOST) {
    throw new Error(`Demo catalogue operations require the exact MongoDB host "${LOCAL_HOST}".`);
  }
}

const findExisting = (Model, filter, projection) => Model.find(filter).select(projection).lean();

async function insertOnly(Model, records, getFilter) {
  let inserted = 0;
  for (const record of records) {
    const result = await Model.updateOne(getFilter(record), { $setOnInsert: record }, { upsert: true });
    if (result.upsertedCount === 1) inserted += 1;
  }
  return { inserted, alreadyPresent: records.length - inserted };
}

export async function seedDemoCatalog({
  target,
  Category,
  Collection,
  Product,
  categories,
  collections,
  products
}) {
  validateDemoCatalogTarget(target);

  const categoryNames = categories.map(({ name }) => name);
  const categorySlugs = categories.map(({ slug }) => slug);
  const collectionNames = collections.map(({ name }) => name);
  const collectionSlugs = collections.map(({ slug }) => slug);
  const productNames = products.map(({ name }) => name);
  const productSlugs = products.map(({ slug }) => slug);
  const demoKeys = products.map(({ demoKey }) => demoKey);
  const skus = products.flatMap(({ variants = [] }) => variants.map(({ sku }) => sku)).filter(Boolean);

  const [existingCategories, existingCollections, existingProducts, existingSkuRecords] = await Promise.all([
    findExisting(Category, { $or: [{ slug: { $in: categorySlugs } }, { name: { $in: categoryNames } }] }, 'slug name'),
    findExisting(Collection, { $or: [{ slug: { $in: collectionSlugs } }, { name: { $in: collectionNames } }] }, 'slug name'),
    findExisting(Product, {
      $or: [
        { slug: { $in: productSlugs } },
        { name: { $in: productNames } },
        { demoKey: { $in: demoKeys } }
      ]
    }, 'slug name category collectionName isDemoData demoKey variants'),
    skus.length
      ? findExisting(Product, { 'variants.sku': { $in: skus } }, 'isDemoData demoKey variants')
      : Promise.resolve([])
  ]);

  for (const existing of existingCategories) {
    const proposed = categories.find((record) => record.slug === existing.slug || record.name === existing.name);
    if (!proposed || proposed.slug !== existing.slug || proposed.name !== existing.name) {
      throw new Error(`Demo identity collision for category "${existing.slug || existing.name}". No catalogue data was written.`);
    }
  }
  for (const existing of existingCollections) {
    const proposed = collections.find((record) => record.slug === existing.slug || record.name === existing.name);
    if (!proposed || proposed.slug !== existing.slug || proposed.name !== existing.name) {
      throw new Error(`Demo identity collision for collection "${existing.slug || existing.name}". No catalogue data was written.`);
    }
  }
  for (const existing of existingProducts) {
    const proposed = products.find((record) =>
      record.slug === existing.slug ||
      record.name === existing.name ||
      record.demoKey === existing.demoKey
    );
    if (!proposed ||
      proposed.slug !== existing.slug ||
      proposed.name !== existing.name ||
      proposed.category !== existing.category ||
      proposed.collectionName !== existing.collectionName ||
      existing.isDemoData !== true ||
      existing.demoKey !== proposed.demoKey) {
      throw new Error(`Demo identity collision for product "${existing.slug || existing.name}". No catalogue data was written.`);
    }
  }
  const skuCollision = existingSkuRecords.some((existing) => {
    if (existing.isDemoData === true && demoKeys.includes(existing.demoKey)) return false;
    return (existing.variants || []).some((variant) => skus.includes(variant.sku));
  });
  if (skuCollision) {
    throw new Error('Demo SKU collision detected. No catalogue data was written.');
  }

  const [categorySummary, collectionSummary, productSummary] = await Promise.all([
    insertOnly(Category, categories, ({ slug }) => ({ slug })),
    insertOnly(Collection, collections, ({ slug }) => ({ slug })),
    insertOnly(Product, products, ({ demoKey }) => ({ demoKey }))
  ]);
  return { categories: categorySummary, collections: collectionSummary, products: productSummary };
}
