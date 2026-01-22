import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';

// Store for Telegram clients per user (in production, use Redis or similar)
const telegramClients: Map<string, TelegramClient> = new Map();

export const setupTelegram = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { botToken, channelId } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!botToken || !channelId) {
            res.status(400).json({
                error: 'Bot token and channel ID are required'
            });
            return;
        }

        // Check if user already has telegram config
        const existingConfig = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (existingConfig) {
            // Update existing config - mark as using own bots
            await prisma.telegramConfig.update({
                where: { userId },
                data: {
                    botToken,
                    channelId,
                    useSystemBots: false,
                },
            });
        } else {
            // Create new config with own bot
            await prisma.telegramConfig.create({
                data: {
                    userId,
                    botToken,
                    channelId,
                    useSystemBots: false,
                },
            });
        }

        res.json({
            message: 'Telegram configuration saved successfully',
            configured: true,
        });
    } catch (error) {
        console.error('Setup telegram error:', error);
        res.status(500).json({ error: 'Failed to save Telegram configuration' });
    }
};

// Skip setup - use system bots with 100MB limit
export const skipSetup = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const systemChannelId = process.env.SYSTEM_CHANNEL_ID;
        if (!systemChannelId) {
            res.status(500).json({ error: 'System configuration not available' });
            return;
        }

        // Check if user already has telegram config
        const existingConfig = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (existingConfig) {
            // Update to use system bots
            await prisma.telegramConfig.update({
                where: { userId },
                data: {
                    channelId: systemChannelId,
                    useSystemBots: true,
                    botToken: null,
                    apiId: null,
                    apiHash: null,
                },
            });
        } else {
            // Create config with system bots
            await prisma.telegramConfig.create({
                data: {
                    userId,
                    channelId: systemChannelId,
                    useSystemBots: true,
                },
            });
        }

        res.json({
            message: 'Setup skipped - using system bots with 100MB limit',
            configured: true,
            useSystemBots: true,
        });
    } catch (error) {
        console.error('Skip setup error:', error);
        res.status(500).json({ error: 'Failed to skip setup' });
    }
};

export const getTelegramStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            select: {
                id: true,
                channelId: true,
                createdAt: true,
            },
        });

        res.json({
            configured: !!config,
            channelId: config?.channelId || null,
        });
    } catch (error) {
        console.error('Get telegram status error:', error);
        res.status(500).json({ error: 'Failed to get Telegram status' });
    }
};

export const validateTelegram = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            res.status(404).json({ error: 'Telegram not configured' });
            return;
        }

        if (!config.botToken || !config.apiId || !config.apiHash) {
            res.status(400).json({ error: 'Telegram credentials incomplete. Please reconfigure.' });
            return;
        }

        // Create a Telegram client to validate credentials
        const stringSession = new StringSession('');
        const client = new TelegramClient(
            stringSession,
            parseInt(config.apiId),
            config.apiHash,
            { connectionRetries: 3 }
        );

        await client.start({
            botAuthToken: config.botToken,
        });

        // Try to get channel info to validate
        const channel = await client.getEntity(config.channelId);

        // Store client for later use
        telegramClients.set(userId, client);

        res.json({
            valid: true,
            channelTitle: (channel as any).title || 'Channel',
        });
    } catch (error: any) {
        console.error('Validate telegram error:', error);
        res.status(400).json({
            valid: false,
            error: error.message || 'Failed to validate Telegram credentials'
        });
    }
};

export const getTelegramClient = async (userId: string): Promise<TelegramClient | null> => {
    // Check if we already have a client
    let client = telegramClients.get(userId);
    if (client && client.connected) {
        return client;
    }

    // Get config and create new client
    const config = await prisma.telegramConfig.findUnique({
        where: { userId },
    });

    if (!config) {
        return null;
    }

    if (!config.botToken || !config.apiId || !config.apiHash) {
        return null;
    }

    const stringSession = new StringSession('');
    client = new TelegramClient(
        stringSession,
        parseInt(config.apiId),
        config.apiHash,
        { connectionRetries: 3 }
    );

    await client.start({
        botAuthToken: config.botToken,
    });

    telegramClients.set(userId, client);
    return client;
};

export { telegramClients };
