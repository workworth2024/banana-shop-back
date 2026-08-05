import express from 'express';
import {
  getTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember, reorderTeamMembers
} from '../../controllers/teamController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';
import upload from '../../middlewares/uploadMiddleware.js';

const router = express.Router();

const canManageTeam = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Team management' });
  }
};

router.get('/', verifyToken, canManageTeam, getTeamMembers);
router.post('/', verifyToken, canManageTeam, upload.single('photo'), createTeamMember);
router.put('/reorder', verifyToken, canManageTeam, reorderTeamMembers);
router.put('/:id', verifyToken, canManageTeam, upload.single('photo'), updateTeamMember);
router.delete('/:id', verifyToken, canManageTeam, deleteTeamMember);

export default router;
