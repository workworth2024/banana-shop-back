import express from 'express';
import {
  getContactForms, updateContactFormStatus, deleteContactForm
} from '../../controllers/contactFormController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const canManageForms = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Contact forms management' });
  }
};

router.get('/', verifyToken, canManageForms, getContactForms);
router.put('/:id/status', verifyToken, canManageForms, updateContactFormStatus);
router.delete('/:id', verifyToken, canManageForms, deleteContactForm);

export default router;
