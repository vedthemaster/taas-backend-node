import { Router } from 'express';
import { googleSignIn, getMe } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Google Sign-In
router.post('/google', googleSignIn);

// Get current user
router.get('/me', authMiddleware, getMe);

export default router;
