import { Router } from 'express';
import {
  addSupportReply,
  createSupportTicket,
  getSupportAssignees,
  getSupportTicket,
  getSupportTickets,
  updateSupportTicket
} from '../controllers/supportController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/assignees', requireAdmin, getSupportAssignees);
router.get('/tickets', getSupportTickets);
router.post('/tickets', createSupportTicket);
router.get('/tickets/:id', getSupportTicket);
router.patch('/tickets/:id', requireAdmin, updateSupportTicket);
router.post('/tickets/:id/replies', addSupportReply);

export default router;
