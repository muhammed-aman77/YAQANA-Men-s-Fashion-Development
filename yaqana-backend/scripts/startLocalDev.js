import { createLocalDevelopmentEnvironment } from '../src/config/localDevelopmentEnvironment.js';

Object.assign(process.env, createLocalDevelopmentEnvironment());
await import('../src/server.js');
