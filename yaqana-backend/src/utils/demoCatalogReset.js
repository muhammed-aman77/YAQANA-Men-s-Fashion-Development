const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_HOST = '127.0.0.1:27017';
const RESET_CONFIRMATION = 'RESET-DEMO-CATALOGUE';

export function validateDemoCatalogResetTarget({
  nodeEnvironment,
  databaseName,
  hosts,
  confirmation,
  resetConfirmation
}) {
  if (nodeEnvironment !== 'development') {
    throw new Error('Demo reset requires NODE_ENV=development.');
  }
  if (databaseName !== LOCAL_DATABASE) {
    throw new Error(`Demo reset requires database "${LOCAL_DATABASE}".`);
  }
  if (confirmation !== LOCAL_DATABASE) {
    throw new Error(`Pass --confirm-local-database=${LOCAL_DATABASE} to continue.`);
  }
  if (resetConfirmation !== RESET_CONFIRMATION) {
    throw new Error(`Pass --confirm-reset=${RESET_CONFIRMATION} to continue.`);
  }
  if (!Array.isArray(hosts) || hosts.length !== 1 || hosts[0] !== LOCAL_HOST) {
    throw new Error(`Demo reset requires the exact MongoDB host "${LOCAL_HOST}".`);
  }
}

export async function resetDemoCatalog({
  target,
  apply,
  Product,
  Cart,
  Wishlist,
  Order,
  StockMovement,
  InventoryInbound,
  InventoryApproval
}) {
  validateDemoCatalogResetTarget(target);
  const products = await Product.find({
    isDemoData: true,
    demoKey: /^YAQANA-DEMO-/
  }).select('_id name slug demoKey').lean();
  const productIds = products.map(({ _id }) => _id);

  if (apply && productIds.length) {
    const references = await Promise.all([
      Cart?.exists({ 'items.product': { $in: productIds } }),
      Wishlist?.exists({ products: { $in: productIds } }),
      Order?.exists({ 'items.product': { $in: productIds } }),
      StockMovement?.exists({ 'changes.product': { $in: productIds } }),
      InventoryInbound?.exists({ product: { $in: productIds } }),
      InventoryApproval?.exists({ product: { $in: productIds } })
    ]);
    if (references.some(Boolean)) {
      throw new Error('Demo reset refused: one or more demo products are referenced. No demo records were deleted.');
    }
  }

  let deletedCount = 0;
  if (apply && productIds.length) {
    const result = await Product.deleteMany({
      isDemoData: true,
      demoKey: /^YAQANA-DEMO-/,
      _id: { $in: productIds }
    });
    deletedCount = result.deletedCount || 0;
  }
  return { apply: Boolean(apply), productCount: products.length, deletedCount };
}
