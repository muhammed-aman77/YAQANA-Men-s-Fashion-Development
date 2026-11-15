import mongoose from 'mongoose';
import { env } from './env.js';
import { requireTransactionTopology } from '../utils/mongoTransactions.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
    minPoolSize: 2
  });
  try {
    requireTransactionTopology(mongoose.connection, env.REQUIRE_MONGO_TRANSACTIONS);
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
