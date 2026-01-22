import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import axios from 'axios';

// Telegram Bot API URL
const TELEGRAM_API_URL = 'https://api.telegram.org';

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

        // Verify the bot token directly with Telegram API
        let verification: { valid: boolean; data?: { username: string }; error?: string };

        try {
            const response = await axios.get(`${TELEGRAM_API_URL}/bot${botToken}/getMe`, {
                timeout: 10000,
            });

            if (response.data.ok && response.data.result) {
                verification = {
                    valid: true,
                    data: { username: response.data.result.username },
                };
            } else {
                verification = { valid: false, error: 'Invalid response from Telegram' };
            }
        } catch (err: any) {
            const errorMsg = err.response?.data?.description || err.message || 'Failed to verify bot';
            verification = { valid: false, error: errorMsg };
        }

        if (!verification.valid) {
            res.status(400).json({ error: `Invalid bot token: ${verification.error}` });
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

        // Ensure config exists after potential creation/refresh
        if (!config) {
            res.status(500).json({ error: 'Failed to get Telegram configuration' });
            return;
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
                botUsername: verification.data?.username || 'Unknown',
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
