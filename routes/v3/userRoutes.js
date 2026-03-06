import express from 'express';
import { getUsers, createUser, updateUser, deleteUser, getRoles } from '../../controllers/userController.js';
import { verifyToken, isAdmin } from '../../middlewares/authMiddleware.js';

const router = express.Router();

// User management (Protected)
router.get('/', verifyToken, getUsers);
router.post('/', verifyToken, isAdmin, createUser);
router.put('/:id', verifyToken, isAdmin, updateUser);
router.delete('/:id', verifyToken, isAdmin, deleteUser);
router.get('/roles', verifyToken, getRoles);

export default router;
