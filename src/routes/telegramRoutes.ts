import { Router } from 'express';
import { setupTelegram, getTelegramStatus, validateTelegram } from '../controllers/telegramController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/setup', authMiddleware, setupTelegram);
router.get('/status', authMiddleware, getTelegramStatus);
router.post('/validate', authMiddleware, validateTelegram);

export default router;
