import mongoose from 'mongoose';
import {
  configureLocalDevelopmentMongoose,
  createLocalDevelopmentEnvironment
} from '../src/config/localDevelopmentEnvironment.js';

configureLocalDevelopmentMongoose(mongoose);
Object.assign(process.env, createLocalDevelopmentEnvironment());
await import('../src/server.js');
