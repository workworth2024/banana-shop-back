import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import { verifyCustomer } from '../../middlewares/customerAuthMiddleware.js';
import uploadSupport from '../../middlewares/uploadSupportMiddleware.js';
import {
  customerListTickets,
  customerGetTicket,
  customerGetMessages,
  customerCreateTicket,
  customerSendMessage,
  customerMarkRead,
  customerActiveTickets,
  staffListTickets,
  staffGetTicket,
  staffGetMessages,
  staffSendMessage,
  staffAssign,
  staffClose,
  staffReopen,
  staffMarkRead,
  staffStats,
  staffStartTicket
} from '../../controllers/supportController.js';

const router = express.Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many messages, slow down' }
});

const allowAnyStaff = (req, res, next) => {
  const access = req.user?.role_id?.access;
  const roleName = req.user?.role_id?.name;
  if (!access || access === 'nothing' || roleName === 'new') {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

/* ----- Customer ----- */
router.get('/my/tickets', verifyCustomer, customerListTickets);
router.get('/my/active', verifyCustomer, customerActiveTickets);
router.get('/my/tickets/:id', verifyCustomer, customerGetTicket);
router.get('/my/tickets/:id/messages', verifyCustomer, customerGetMessages);
router.post('/my/tickets', verifyCustomer, sendLimiter, uploadSupport.array('attachments', 5), customerCreateTicket);
router.post('/my/tickets/:id/messages', verifyCustomer, sendLimiter, uploadSupport.array('attachments', 5), customerSendMessage);
router.post('/my/tickets/:id/read', verifyCustomer, customerMarkRead);

/* ----- Staff ----- */
router.post('/tickets/start', verifyToken, allowAnyStaff, sendLimiter, uploadSupport.array('attachments', 5), staffStartTicket);
router.get('/tickets', verifyToken, allowAnyStaff, staffListTickets);
router.get('/stats', verifyToken, allowAnyStaff, staffStats);
router.get('/tickets/:id', verifyToken, allowAnyStaff, staffGetTicket);
router.get('/tickets/:id/messages', verifyToken, allowAnyStaff, staffGetMessages);
router.post('/tickets/:id/messages', verifyToken, allowAnyStaff, sendLimiter, uploadSupport.array('attachments', 5), staffSendMessage);
router.post('/tickets/:id/assign', verifyToken, allowAnyStaff, staffAssign);
router.post('/tickets/:id/close', verifyToken, allowAnyStaff, staffClose);
router.post('/tickets/:id/reopen', verifyToken, allowAnyStaff, staffReopen);
router.post('/tickets/:id/read', verifyToken, allowAnyStaff, staffMarkRead);

export default router;
