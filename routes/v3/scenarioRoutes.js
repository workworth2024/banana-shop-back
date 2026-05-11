import express from 'express';
import {
  getScenarios, getScenarioById, createScenario, updateScenario, deleteScenario
} from '../../controllers/scenarioController.js';
import { verifyToken } from '../../middlewares/authMiddleware.js';

const router = express.Router();

const canManage = (req, res, next) => {
  const role = req.user.role_id.name;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ message: 'Access denied' });
};

router.get('/', verifyToken, getScenarios);
router.get('/:id', verifyToken, getScenarioById);
router.post('/', verifyToken, canManage, createScenario);
router.put('/:id', verifyToken, canManage, updateScenario);
router.delete('/:id', verifyToken, canManage, deleteScenario);

export default router;
