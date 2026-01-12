import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getBots, addBot, removeBot, updateChannelId } from '../controllers/botController';

const router = Router();

// Get all bots for user
router.get('/', authMiddleware, getBots);

// Add a new bot
router.post('/', authMiddleware, addBot);

// Remove a bot
router.delete('/:botId', authMiddleware, removeBot);

// Update channel ID
router.put('/channel', authMiddleware, updateChannelId);

export default router;
