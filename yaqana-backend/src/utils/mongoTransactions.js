import mongoose from 'mongoose';

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'Sharded']);

export function supportsMongoTransactions(connection = mongoose.connection) {
  const topology = connection?.client?.topology?.description?.type;
  return TRANSACTION_TOPOLOGIES.has(topology);
}

export function requireTransactionTopology(connection, required) {
  if (required && !supportsMongoTransactions(connection)) {
    throw new Error('This environment requires a MongoDB replica set or sharded cluster for transaction-safe checkout and order workflows.');
  }
}
