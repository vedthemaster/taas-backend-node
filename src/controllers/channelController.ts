import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

/**
 * Get all channels for the current user
 * GET /api/channels
 */
export const getChannels = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { channels: true },
        });

        if (!config) {
            res.json({
                primaryChannel: null,
                channels: [],
            });
            return;
        }

        res.json({
            primaryChannel: config.channelId,
            channels: config.channels.map(ch => ({
                id: ch.id,
                channelId: ch.channelId,
                name: ch.name,
                isActive: ch.isActive,
                createdAt: ch.createdAt,
            })),
        });
    } catch (error) {
        console.error('Get channels error:', error);
        res.status(500).json({ error: 'Failed to get channels' });
    }
};

/**
 * Add a new channel
 * POST /api/channels
 */
export const addChannel = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { channelId, name } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!channelId) {
            res.status(400).json({ error: 'Channel ID is required' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            res.status(400).json({ error: 'Please complete Telegram setup first' });
            return;
        }

        // Check if this channel already exists
        const existingChannel = await prisma.telegramChannel.findUnique({
            where: { configId_channelId: { configId: config.id, channelId } },
        });

        if (existingChannel) {
            res.status(400).json({ error: 'Channel already added' });
            return;
        }

        // Also check if it's the primary channel
        if (config.channelId === channelId) {
            res.status(400).json({ error: 'This is already your primary channel' });
            return;
        }

        // Verify the channel works with at least one bot
        const bots = await prisma.telegramBot.findMany({
            where: { configId: config.id, isActive: true },
        });

        if (bots.length === 0 && !config.useSystemBots) {
            res.status(400).json({ error: 'Please add at least one bot first' });
            return;
        }

        // Get a bot token to test
        let testBotToken: string;
        if (config.useSystemBots) {
            const { getSystemBotTokens } = await import('./botController');
            const tokens = getSystemBotTokens();
            if (tokens.length === 0) {
                res.status(500).json({ error: 'System bots not configured' });
                return;
            }
            testBotToken = tokens[0];
        } else {
            testBotToken = bots[0].botToken;
        }

        // Try to send a test message to verify access
        try {
            const axios = (await import('axios')).default;
            const testResponse = await axios.post(
                `https://api.telegram.org/bot${testBotToken}/sendMessage`,
                {
                    chat_id: channelId,
                    text: '✅ Channel verified for TelegramAsAStorage',
                },
                { timeout: 10000 }
            );

            if (!testResponse.data.ok) {
                throw new Error(testResponse.data.description || 'Failed to verify channel');
            }

            // Delete the test message
            const messageId = testResponse.data.result.message_id;
            await axios.post(
                `https://api.telegram.org/bot${testBotToken}/deleteMessage`,
                { chat_id: channelId, message_id: messageId },
                { timeout: 5000 }
            ).catch(() => { /* Ignore delete errors */ });
        } catch (error: any) {
            const errorMsg = error.response?.data?.description || error.message || 'Unknown error';
            res.status(400).json({
                error: 'Failed to verify channel access',
                details: errorMsg,
            });
            return;
        }

        // Create the channel record
        const channel = await prisma.telegramChannel.create({
            data: {
                configId: config.id,
                channelId,
                name: name || null,
            },
        });

        res.status(201).json({
            message: 'Channel added successfully',
            channel: {
                id: channel.id,
                channelId: channel.channelId,
                name: channel.name,
                isActive: channel.isActive,
                createdAt: channel.createdAt,
            },
        });
    } catch (error) {
        console.error('Add channel error:', error);
        res.status(500).json({ error: 'Failed to add channel' });
    }
};

/**
 * Remove a channel
 * DELETE /api/channels/:id
 */
export const removeChannel = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            res.status(400).json({ error: 'No Telegram configuration found' });
            return;
        }

        // Verify the channel belongs to this user
        const channel = await prisma.telegramChannel.findFirst({
            where: { id, configId: config.id },
        });

        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        // Delete the channel
        await prisma.telegramChannel.delete({
            where: { id },
        });

        res.json({ message: 'Channel removed successfully' });
    } catch (error) {
        console.error('Remove channel error:', error);
        res.status(500).json({ error: 'Failed to remove channel' });
    }
};

/**
 * Update a channel (name, isActive)
 * PATCH /api/channels/:id
 */
export const updateChannel = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { name, isActive } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            res.status(400).json({ error: 'No Telegram configuration found' });
            return;
        }

        // Verify the channel belongs to this user
        const channel = await prisma.telegramChannel.findFirst({
            where: { id, configId: config.id },
        });

        if (!channel) {
            res.status(404).json({ error: 'Channel not found' });
            return;
        }

        // Update the channel
        const updated = await prisma.telegramChannel.update({
            where: { id },
            data: {
                name: name !== undefined ? name : channel.name,
                isActive: isActive !== undefined ? isActive : channel.isActive,
            },
        });

        res.json({
            message: 'Channel updated successfully',
            channel: {
                id: updated.id,
                channelId: updated.channelId,
                name: updated.name,
                isActive: updated.isActive,
            },
        });
    } catch (error) {
        console.error('Update channel error:', error);
        res.status(500).json({ error: 'Failed to update channel' });
    }
};
