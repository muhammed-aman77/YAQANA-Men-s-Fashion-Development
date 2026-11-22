import { randomBytes } from 'node:crypto';

export const LOCAL_DEVELOPMENT_MONGODB_URI = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

export function configureLocalDevelopmentMongoose(mongoose) {
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
}

export function createLocalDevelopmentEnvironment(environment = process.env) {
  const existingSecret = typeof environment.JWT_SECRET === 'string' ? environment.JWT_SECRET.trim() : '';
  return {
    ...environment,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    MONGODB_URI: LOCAL_DEVELOPMENT_MONGODB_URI,
    FRONTEND_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
    JWT_SECRET: existingSecret.length >= 32
      ? existingSecret
      : randomBytes(48).toString('base64url')
  };
}

export function createLocalDemoScriptEnvironment(environment = process.env) {
  const localEnvironment = createLocalDevelopmentEnvironment(environment);
  return {
    NODE_ENV: localEnvironment.NODE_ENV,
    MONGODB_URI: localEnvironment.MONGODB_URI,
    JWT_SECRET: localEnvironment.JWT_SECRET
  };
}
