import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(86400),
  LEGACY_CURRENCY_FACTOR: z.coerce.number().positive().default(83),
  LEGACY_SHIPPING_THRESHOLD: z.coerce.number().nonnegative().default(200),
  LEGACY_SHIPPING_FEE: z.coerce.number().nonnegative().default(15),
  LEGACY_TAX_RATE: z.coerce.number().min(0).max(1).default(0.08),
  FRONTEND_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  AUTH_COOKIE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  REQUIRE_MONGO_TRANSACTIONS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MEDIA_STORAGE: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().trim().default(''),
  CLOUDINARY_API_KEY: z.string().trim().default(''),
  CLOUDINARY_API_SECRET: z.string().trim().default(''),
  LOG_LEVEL: z.string().default('info')
}).superRefine((config, context) => {
  const origins = config.FRONTEND_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      context.addIssue({ code: 'custom', path: ['FRONTEND_ORIGINS'], message: `Invalid origin: ${origin}` });
      continue;
    }
    if (parsedOrigin.origin !== origin) {
      context.addIssue({ code: 'custom', path: ['FRONTEND_ORIGINS'], message: `Origin must be exact: ${origin}` });
    }
    if (config.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
      context.addIssue({ code: 'custom', path: ['FRONTEND_ORIGINS'], message: 'Production origins must use HTTPS.' });
    }
  }

  if (config.NODE_ENV === 'production' && !config.AUTH_COOKIE_ENABLED) {
    context.addIssue({ code: 'custom', path: ['AUTH_COOKIE_ENABLED'], message: 'Production requires cookie authentication.' });
  }
  if (config.NODE_ENV === 'production' && !config.REQUIRE_MONGO_TRANSACTIONS) {
    context.addIssue({ code: 'custom', path: ['REQUIRE_MONGO_TRANSACTIONS'], message: 'Production requires MongoDB transaction support.' });
  }
  if (config.NODE_ENV === 'production' && config.MEDIA_STORAGE !== 'cloudinary') {
    context.addIssue({ code: 'custom', path: ['MEDIA_STORAGE'], message: 'Production media storage must use Cloudinary.' });
  }
  if (config.MEDIA_STORAGE === 'cloudinary') {
    for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
      if (!config[key]) context.addIssue({ code: 'custom', path: [key], message: `${key} is required for Cloudinary storage.` });
    }
  }
});

export function parseEnvironment(environment) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const origins = parsed.data.FRONTEND_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  return Object.freeze({ ...parsed.data, allowedOrigins: origins });
}
