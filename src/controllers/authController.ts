import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

const generateToken = (userId: string): string => {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        throw new Error('JWT secret not configured');
    }
    return jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' });
};

// Initialize Google OAuth client
const getGoogleClient = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        throw new Error('GOOGLE_CLIENT_ID not configured');
    }
    return new OAuth2Client(clientId);
};

/**
 * Google Sign-In
 * POST /api/auth/google
 * Receives Google ID token, verifies it, creates/updates user
 */
export const googleSignIn = async (req: Request, res: Response): Promise<void> => {
    try {
        const { credential } = req.body;

        if (!credential) {
            res.status(400).json({ error: 'Google credential is required' });
            return;
        }

        // Verify the Google ID token
        const client = getGoogleClient();
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload) {
            res.status(401).json({ error: 'Invalid Google token' });
            return;
        }

        const { sub: googleId, email, name, picture } = payload;

        if (!email) {
            res.status(400).json({ error: 'Email not provided by Google' });
            return;
        }

        // Find or create user
        let user = await prisma.user.findFirst({
            where: {
                OR: [
                    { googleId },
                    { email },
                ],
            },
            include: {
                telegramConfig: true,
            },
        });

        if (user) {
            // Update Google info if changed
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    googleId,
                    name: name || user.name,
                    picture: picture || user.picture,
                },
                include: {
                    telegramConfig: true,
                },
            });
        } else {
            // Create new user
            user = await prisma.user.create({
                data: {
                    email,
                    googleId,
                    name,
                    picture,
                },
                include: {
                    telegramConfig: true,
                },
            });
        }

        // Generate JWT token
        const token = generateToken(user.id);

        const useSystemBots = user.telegramConfig?.useSystemBots ?? false;
        const maxUploadSize = useSystemBots ? 100 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                createdAt: user.createdAt,
                hasTelegramConfig: !!user.telegramConfig,
                useSystemBots,
                maxUploadSize,
            },
            token,
        });
    } catch (error: any) {
        console.error('Google sign-in error:', error?.message || error);

        // Handle specific error cases
        if (error.message?.includes('GOOGLE_CLIENT_ID')) {
            res.status(500).json({ error: 'Server configuration error. Google Client ID not set.' });
            return;
        }

        if (error.message?.includes('Token used too late') || error.message?.includes('Invalid token signature')) {
            res.status(401).json({ error: 'Google sign-in expired. Please try again.' });
            return;
        }

        if (error.message?.includes('Wrong recipient') || error.message?.includes('audience')) {
            res.status(401).json({ error: 'Invalid Google credentials configuration.' });
            return;
        }

        if (error.code === 'P2002') {
            res.status(409).json({ error: 'An account with this email already exists.' });
            return;
        }

        res.status(500).json({
            error: 'Failed to sign in with Google',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get current user info
 * GET /api/auth/me
 */
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                picture: true,
                createdAt: true,
                telegramConfig: {
                    select: {
                        id: true,
                        channelId: true,
                        useSystemBots: true,
                        createdAt: true,
                    },
                },
            },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const useSystemBots = user.telegramConfig?.useSystemBots ?? false;
        const maxUploadSize = useSystemBots ? 100 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;

        res.json({
            user: {
                ...user,
                hasTelegramConfig: !!user.telegramConfig,
                useSystemBots,
                maxUploadSize,
            },
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
};
