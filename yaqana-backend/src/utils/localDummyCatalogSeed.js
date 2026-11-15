const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_HOST = '127.0.0.1:27017';

export function validateLocalDummyCatalogTarget({
  nodeEnvironment,
  databaseName,
  hosts,
  confirmation
}) {
  if (nodeEnvironment !== 'development') {
    throw new Error('Local dummy catalogue operations require NODE_ENV=development.');
  }
  if (databaseName !== LOCAL_DATABASE) {
    throw new Error(`Local dummy catalogue operations require database "${LOCAL_DATABASE}".`);
  }
  if (confirmation !== LOCAL_DATABASE) {
    throw new Error(`Pass --confirm-local-database=${LOCAL_DATABASE} to continue.`);
  }
  if (!Array.isArray(hosts) || hosts.length !== 1 || hosts[0] !== LOCAL_HOST) {
    throw new Error(`Local dummy catalogue operations require the exact MongoDB host "${LOCAL_HOST}".`);
  }
}

const findExisting = (Model, filter, projection) => Model.find(filter).select(projection).lean();

const assertNoIdentityCollisions = (existing, proposed, label) => {
  const bySlug = new Map(proposed.map((record) => [record.slug, record]));
  const byName = new Map(proposed.map((record) => [record.name, record]));
  for (const record of existing) {
    const expected = bySlug.get(record.slug) || byName.get(record.name);
    if (!expected || expected.slug !== record.slug || expected.name !== record.name) {
      throw new Error(`${label} identity collision for "${record.slug || record.name}". No catalogue data was written.`);
    }
  }
};

const assertNoProductSlugCollisions = (existing, proposed) => {
  const bySlug = new Map(proposed.map((product) => [product.slug, product]));
  for (const current of existing) {
    const expected = bySlug.get(current.slug);
    if (!expected ||
        current.name !== expected.name ||
        current.category !== expected.category ||
        current.collectionName !== expected.collectionName) {
      throw new Error(`Dummy product identity collision for "${current.slug}". No catalogue data was written.`);
    }
  }
};

const upsertAllInsertOnly = async (Model, records, getKey) => {
  let inserted = 0;
  for (const record of records) {
    const result = await Model.updateOne(getKey(record), { $setOnInsert: record }, { upsert: true });
    if (result.upsertedCount === 1) inserted += 1;
  }
  return { inserted, alreadyPresent: records.length - inserted };
};

export async function seedLocalDummyCatalog({
  target,
  Category,
  Collection,
  Product,
  categories,
  collections,
  products
}) {
  validateLocalDummyCatalogTarget(target);

  const categoryNames = categories.map(({ name }) => name);
  const categorySlugs = categories.map(({ slug }) => slug);
  const collectionNames = collections.map(({ name }) => name);
  const collectionSlugs = collections.map(({ slug }) => slug);
  const productNames = products.map(({ name }) => name);
  const productSlugs = products.map(({ slug }) => slug);
  const [existingCategories, existingCollections, existingProducts] = await Promise.all([
    findExisting(Category, { $or: [{ slug: { $in: categorySlugs } }, { name: { $in: categoryNames } }] }, 'slug name'),
    findExisting(Collection, { $or: [{ slug: { $in: collectionSlugs } }, { name: { $in: collectionNames } }] }, 'slug name'),
    findExisting(Product, { $or: [{ slug: { $in: productSlugs } }, { name: { $in: productNames } }] }, 'slug name category collectionName')
  ]);

  assertNoIdentityCollisions(existingCategories, categories, 'Category');
  assertNoIdentityCollisions(existingCollections, collections, 'Collection');
  assertNoProductSlugCollisions(existingProducts, products);

  const [categorySummary, collectionSummary, productSummary] = await Promise.all([
    upsertAllInsertOnly(Category, categories, ({ slug }) => ({ slug })),
    upsertAllInsertOnly(Collection, collections, ({ slug }) => ({ slug })),
    upsertAllInsertOnly(Product, products, ({ slug }) => ({ slug }))
  ]);
  return { categories: categorySummary, collections: collectionSummary, products: productSummary };
}
