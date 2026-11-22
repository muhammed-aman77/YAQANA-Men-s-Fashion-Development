import { createLocalDemoScriptEnvironment } from '../src/config/localDevelopmentEnvironment.js';

const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_URI = `mongodb://127.0.0.1:27017/${LOCAL_DATABASE}`;
Object.assign(process.env, createLocalDemoScriptEnvironment(process.env));

const [
  { default: mongoose },
  { default: Cart },
  { default: InventoryInbound },
  { default: InventoryApproval },
  { default: Order },
  { default: Product },
  { default: StockMovement },
  { default: Wishlist },
  resetModule
] = await Promise.all([
  import('mongoose'),
  import('../src/models/Cart.js'),
  import('../src/models/InventoryInbound.js'),
  import('../src/models/InventoryApproval.js'),
  import('../src/models/Order.js'),
  import('../src/models/Product.js'),
  import('../src/models/StockMovement.js'),
  import('../src/models/Wishlist.js'),
  import('../src/utils/demoCatalogReset.js')
]);
const { resetDemoCatalog } = resetModule;
const apply = process.argv.includes('--apply');
const confirmationArgs = process.argv.filter((argument) => argument.startsWith('--confirm-local-database='));
const resetArgs = process.argv.filter((argument) => argument.startsWith('--confirm-reset='));
const confirmation = confirmationArgs.length === 1
  ? confirmationArgs[0].slice('--confirm-local-database='.length)
  : undefined;
const resetConfirmation = resetArgs.length === 1
  ? resetArgs[0].slice('--confirm-reset='.length)
  : undefined;

await mongoose.connect(LOCAL_URI, { serverSelectionTimeoutMS: 10000 });
try {
  const hosts = [...mongoose.connection.getClient().topology.description.servers.keys()];
  const result = await resetDemoCatalog({
    target: {
      nodeEnvironment: 'development',
      databaseName: mongoose.connection.name,
      hosts,
      confirmation,
      resetConfirmation
    },
    apply,
    Product,
    Cart,
    Wishlist,
    Order,
    StockMovement,
    InventoryInbound,
    InventoryApproval
  });
  process.stdout.write(`${JSON.stringify({ database: mongoose.connection.name, ...result }, null, 2)}\n`);
  if (!apply) process.stdout.write('Dry run only. No demo records were deleted.\n');
} finally {
  await mongoose.disconnect();
}
