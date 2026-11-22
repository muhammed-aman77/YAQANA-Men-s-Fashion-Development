import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  adminMfaRecovery,
  beginAdminMfaReplacement,
  beginAdminLogin,
  completeAdminMfa,
  completeAdminMfaReplacement,
  getAdminMfaStatus,
  reauthenticateAdmin,
  revokeOtherAdminSessions
} from '../controllers/adminAuthController.js';
import { requireAdmin, requireAuth, requireRecentAdminReauthentication } from '../middleware/auth.js';

const router = Router();
const adminAuthRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const adminMfaProofRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
router.post('/login', adminAuthRateLimit, beginAdminLogin);
router.post('/verify', adminAuthRateLimit, completeAdminMfa);
router.post('/mfa/replacement/start', adminMfaProofRateLimit, requireAuth, requireAdmin, beginAdminMfaReplacement);
router.post('/mfa/replacement/verify', adminMfaProofRateLimit, requireAuth, requireAdmin, completeAdminMfaReplacement);
router.post('/reauthenticate', adminMfaProofRateLimit, requireAuth, requireAdmin, reauthenticateAdmin);
router.get('/mfa', requireAuth, requireAdmin, getAdminMfaStatus);
router.post('/recovery-codes', adminMfaProofRateLimit, requireAuth, requireAdmin, adminMfaRecovery);
router.post('/sessions/revoke-others', requireAuth, requireAdmin, requireRecentAdminReauthentication, revokeOtherAdminSessions);

export default router;
