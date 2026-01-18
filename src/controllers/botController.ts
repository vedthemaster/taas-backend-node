import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import axios from 'axios';

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

/**
 * Get all bots for the current user
 */
export const getBots = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: true },
        });

        if (!config) {
            res.json({ bots: [], channelId: null });
            return;
        }

        res.json({
            channelId: config.channelId,
            bots: config.bots.map((bot) => ({
                id: bot.id,
                username: bot.botUsername,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
            })),
        });
    } catch (error) {
        console.error('Get bots error:', error);
        res.status(500).json({ error: 'Failed to get bots' });
    }
};

/**
 * Add a new bot token
 */
export const addBot = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { botToken, channelId } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!botToken) {
            res.status(400).json({ error: 'Bot token is required' });
            return;
        }

        // Verify the bot token with Python service
        const verification = await axios.post(`${PYTHON_SERVICE_URL}/verify-bot`, {
            bot_token: botToken,
        });

        if (!verification.data.valid) {
            res.status(400).json({ error: `Invalid bot token: ${verification.data.error}` });
            return;
        }

        // Get or create TelegramConfig
        let config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            if (!channelId) {
                res.status(400).json({ error: 'Channel ID is required for first bot' });
                return;
            }

            config = await prisma.telegramConfig.create({
                data: {
                    userId,
                    channelId,
                    useSystemBots: false,
                },
            });
        } else if (config.useSystemBots) {
            // User was using system bots, now adding their own - update to own channel
            if (!channelId) {
                res.status(400).json({ error: 'Channel ID is required when switching from system bots' });
                return;
            }
            await prisma.telegramConfig.update({
                where: { userId },
                data: {
                    useSystemBots: false,
                    channelId,
                },
            });
            // Refresh config
            config = await prisma.telegramConfig.findUnique({
                where: { userId },
            });
        }

        // Check if bot already exists
        const existingBot = await prisma.telegramBot.findFirst({
            where: {
                configId: config.id,
                botToken,
            },
        });

        if (existingBot) {
            res.status(400).json({ error: 'Bot already added' });
            return;
        }

        // Add the bot
        const bot = await prisma.telegramBot.create({
            data: {
                configId: config.id,
                botToken,
                botUsername: verification.data.username,
            },
        });

        res.status(201).json({
            bot: {
                id: bot.id,
                username: bot.botUsername,
                isActive: bot.isActive,
                createdAt: bot.createdAt,
            },
        });
    } catch (error) {
        console.error('Add bot error:', error);
        res.status(500).json({ error: 'Failed to add bot' });
    }
};

/**
 * Remove a bot
 */
export const removeBot = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { botId } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Verify bot belongs to user
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: true },
        });

        if (!config) {
            res.status(404).json({ error: 'No configuration found' });
            return;
        }

        const bot = config.bots.find((b) => b.id === botId);
        if (!bot) {
            res.status(404).json({ error: 'Bot not found' });
            return;
        }

        await prisma.telegramBot.delete({
            where: { id: String(botId) },
        });

        res.json({ message: 'Bot removed successfully' });
    } catch (error) {
        console.error('Remove bot error:', error);
        res.status(500).json({ error: 'Failed to remove bot' });
    }
};

/**
 * Update channel ID
 */
export const updateChannelId = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { channelId } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!channelId) {
            res.status(400).json({ error: 'Channel ID is required' });
            return;
        }

        await prisma.telegramConfig.upsert({
            where: { userId },
            update: { channelId },
            create: {
                userId,
                channelId,
            },
        });

        res.json({ message: 'Channel ID updated successfully' });
    } catch (error) {
        console.error('Update channel ID error:', error);
        res.status(500).json({ error: 'Failed to update channel ID' });
    }
};

/**
 * Get bot tokens for a user (internal use)
 * Returns system bots if user has useSystemBots=true
 */
export const getBotTokensForUser = async (userId: string): Promise<string[]> => {
    const config = await prisma.telegramConfig.findUnique({
        where: { userId },
        include: { bots: { where: { isActive: true } } },
    });

    if (!config) {
        return [];
    }

    // If user is using system bots, return system bot tokens
    if (config.useSystemBots) {
        return getSystemBotTokens();
    }

    // Otherwise return user's own bots
    if (config.bots.length === 0) {
        return [];
    }

    return config.bots.map((b) => b.botToken);
};

/**
 * Get system bot tokens from environment
 */
export const getSystemBotTokens = (): string[] => {
    const tokens = process.env.SYSTEM_BOT_TOKENS || '';
    if (!tokens) return [];
    return tokens.split(',').map(t => t.trim()).filter(t => t.length > 0);
};

/**
 * Check if user is using system bots (for file size limit enforcement)
 */
export const isUsingSystemBots = async (userId: string): Promise<boolean> => {
    const config = await prisma.telegramConfig.findUnique({
        where: { userId },
        select: { useSystemBots: true },
    });
    return config?.useSystemBots ?? false;
};
