import dotenv from 'dotenv';
import { parseEnvironment } from './environmentSchema.js';

dotenv.config();

export const env = parseEnvironment(process.env);
