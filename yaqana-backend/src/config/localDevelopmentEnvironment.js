export const LOCAL_DEVELOPMENT_MONGODB_URI = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

export function createLocalDevelopmentEnvironment(environment = process.env) {
  return {
    ...environment,
    NODE_ENV: 'development',
    MONGODB_URI: LOCAL_DEVELOPMENT_MONGODB_URI
  };
}
