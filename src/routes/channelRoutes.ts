import { Router } from 'express';
import {
    getChannels,
    addChannel,
    removeChannel,
    updateChannel
} from '../controllers/channelController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Get all channels for the current user
router.get('/', authMiddleware, getChannels);

// Add a new channel
router.post('/', authMiddleware, addChannel);

// Update a channel
router.patch('/:id', authMiddleware, updateChannel);

// Remove a channel
router.delete('/:id', authMiddleware, removeChannel);

export default router;
