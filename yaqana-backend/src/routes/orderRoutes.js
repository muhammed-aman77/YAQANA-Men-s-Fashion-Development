import { Router } from 'express';
import {
 createOrder,
 getMyOrders,
 getOrderById,
 getAllOrders,
 updateOrderStatus,
 updateCodLifecycle,
 updateOrderShipment,
 createReturnOrRefund,
 quoteOrder
} from '../controllers/orderController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
const router = Router();
router.use(requireAuth);
router.post('/quote', quoteOrder);
router.post('/', createOrder);
router.get('/my-orders', getMyOrders);
router.get('/', requireAdmin, getAllOrders);
router.get('/:id', getOrderById);
router.put('/:id', requireAdmin, updateOrderStatus);
router.patch('/:id/cod', requireAdmin, updateCodLifecycle);
router.patch('/:id/shipment', requireAdmin, updateOrderShipment);
router.post('/:id/return-refund', createReturnOrRefund);
export default router;
