import mongoose from 'mongoose';
import { SUPPORTED_REPORTING_TIME_ZONES } from '../utils/dashboardReporting.js';
import { CUSTOM_PERMISSIONS, USER_ROLES } from '../utils/staffAuthorization.js';

const adminPreferencesSchema = new mongoose.Schema({
  reportingTimeZone: { type: String, enum: SUPPORTED_REPORTING_TIME_ZONES },
  savedFilters: { type: [mongoose.Schema.Types.Mixed], default: [] },
  notificationStates: {
    type: [{ notificationId: { type: String, required: true, maxlength: 160 }, readAt: { type: Date, default: null } }],
    default: []
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  phone: { type: String, trim: true, default: '' },
  role: { type: String, enum: [...USER_ROLES], default: 'customer' },
  customPermissions: {
    type: [{ type: String, enum: [...CUSTOM_PERMISSIONS] }],
    default: []
  },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  emailVerifiedAt: { type: Date, default: null },
  mfaEnabled: { type: Boolean, default: false },
  mfaLastCounter: { type: Number, default: -1, select: false },
  mfaSecretEncrypted: { type: String, default: null, select: false },
  mfaSetupSecretEncrypted: { type: String, default: null, select: false },
  mfaReplacementSecretEncrypted: { type: String, default: null, select: false },
  mfaReplacementChallengeId: { type: String, default: null, select: false },
  mfaReplacementExpiresAt: { type: Date, default: null, select: false },
  mfaReplacementSessionId: { type: String, default: null, select: false },
  mfaRecoveryCodeHashes: { type: [String], default: [], select: false },
  adminAuthChallengeId: { type: String, default: null, select: false },
  adminAuthChallengeExpiresAt: { type: Date, default: null, select: false },
  adminPreferences: {
    type: adminPreferencesSchema,
    default: undefined,
    validate: {
      validator(value) {
        return value == null || ['admin', 'owner'].includes(this.role);
      },
      message: 'Administrator preferences are only available for admin users.'
    }
  }
}, { timestamps: true, toJSON: { transform(_doc, ret) {
  for (const field of ['passwordHash', 'mfaLastCounter', 'mfaSecretEncrypted', 'mfaSetupSecretEncrypted', 'mfaReplacementSecretEncrypted', 'mfaReplacementChallengeId', 'mfaReplacementExpiresAt', 'mfaReplacementSessionId', 'mfaRecoveryCodeHashes', 'adminAuthChallengeId', 'adminAuthChallengeExpiresAt']) delete ret[field];
  delete ret.__v;
  return ret;
} } });

userSchema.index({ role: 1, createdAt: 1 });
userSchema.index({ role: 1 }, {
  unique: true,
  partialFilterExpression: { role: 'owner' },
  name: 'unique_owner_identity'
});

export default mongoose.model('User', userSchema);
