"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.telegramClients = exports.getTelegramClient = exports.validateTelegram = exports.getTelegramStatus = exports.setupTelegram = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const telegram_1 = require("telegram");
const sessions_1 = require("telegram/sessions");
// Store for Telegram clients per user (in production, use Redis or similar)
const telegramClients = new Map();
exports.telegramClients = telegramClients;
const setupTelegram = async (req, res) => {
    try {
        const userId = req.userId;
        const { botToken, channelId, apiId, apiHash } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        if (!botToken || !channelId || !apiId || !apiHash) {
            res.status(400).json({
                error: 'Bot token, channel ID, API ID, and API hash are required'
            });
            return;
        }
        // Check if user already has telegram config
        const existingConfig = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (existingConfig) {
            // Update existing config
            await prisma_1.default.telegramConfig.update({
                where: { userId },
                data: {
                    botToken,
                    channelId,
                    apiId,
                    apiHash,
                },
            });
        }
        else {
            // Create new config
            await prisma_1.default.telegramConfig.create({
                data: {
                    userId,
                    botToken,
                    channelId,
                    apiId,
                    apiHash,
                },
            });
        }
        res.json({
            message: 'Telegram configuration saved successfully',
            configured: true,
        });
    }
    catch (error) {
        console.error('Setup telegram error:', error);
        res.status(500).json({ error: 'Failed to save Telegram configuration' });
    }
};
exports.setupTelegram = setupTelegram;
const getTelegramStatus = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const config = await prisma_1.default.telegramConfig.findUnique({
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
    }
    catch (error) {
        console.error('Get telegram status error:', error);
        res.status(500).json({ error: 'Failed to get Telegram status' });
    }
};
exports.getTelegramStatus = getTelegramStatus;
const validateTelegram = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const config = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (!config) {
            res.status(404).json({ error: 'Telegram not configured' });
            return;
        }
        // Create a Telegram client to validate credentials
        const stringSession = new sessions_1.StringSession('');
        const client = new telegram_1.TelegramClient(stringSession, parseInt(config.apiId), config.apiHash, { connectionRetries: 3 });
        await client.start({
            botAuthToken: config.botToken,
        });
        // Try to get channel info to validate
        const channel = await client.getEntity(config.channelId);
        // Store client for later use
        telegramClients.set(userId, client);
        res.json({
            valid: true,
            channelTitle: channel.title || 'Channel',
        });
    }
    catch (error) {
        console.error('Validate telegram error:', error);
        res.status(400).json({
            valid: false,
            error: error.message || 'Failed to validate Telegram credentials'
        });
    }
};
exports.validateTelegram = validateTelegram;
const getTelegramClient = async (userId) => {
    // Check if we already have a client
    let client = telegramClients.get(userId);
    if (client && client.connected) {
        return client;
    }
    // Get config and create new client
    const config = await prisma_1.default.telegramConfig.findUnique({
        where: { userId },
    });
    if (!config) {
        return null;
    }
    const stringSession = new sessions_1.StringSession('');
    client = new telegram_1.TelegramClient(stringSession, parseInt(config.apiId), config.apiHash, { connectionRetries: 3 });
    await client.start({
        botAuthToken: config.botToken,
    });
    telegramClients.set(userId, client);
    return client;
};
exports.getTelegramClient = getTelegramClient;
//# sourceMappingURL=telegramController.js.map