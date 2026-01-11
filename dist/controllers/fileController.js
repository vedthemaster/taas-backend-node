"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFile = exports.downloadFile = exports.uploadFile = exports.getFile = exports.getFiles = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const telegramController_1 = require("./telegramController");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Helper to generate unique filename for duplicates
const getUniqueFilename = async (originalName, folderId, userId) => {
    // Split name and extension
    const lastDotIndex = originalName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName;
    const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : '';
    // Check if file with same name exists
    const existingFile = await prisma_1.default.file.findFirst({
        where: {
            name: originalName,
            folderId,
            userId,
        },
    });
    if (!existingFile) {
        return originalName;
    }
    // Find the next available number
    let counter = 1;
    let newName = `${baseName} (${counter})${extension}`;
    while (true) {
        const exists = await prisma_1.default.file.findFirst({
            where: {
                name: newName,
                folderId,
                userId,
            },
        });
        if (!exists) {
            return newName;
        }
        counter++;
        newName = `${baseName} (${counter})${extension}`;
    }
};
const getFiles = async (req, res) => {
    try {
        const userId = req.userId;
        const { folderId } = req.query;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const files = await prisma_1.default.file.findMany({
            where: {
                userId,
                folderId: folderId ? String(folderId) : null,
            },
            orderBy: { name: 'asc' },
        });
        // Convert BigInt to string for JSON serialization
        const filesWithStringSize = files.map(file => ({
            ...file,
            size: file.size.toString(),
        }));
        res.json({ files: filesWithStringSize });
    }
    catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: 'Failed to get files' });
    }
};
exports.getFiles = getFiles;
const getFile = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const file = await prisma_1.default.file.findFirst({
            where: { id, userId },
        });
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        res.json({
            file: {
                ...file,
                size: file.size.toString(),
            }
        });
    }
    catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({ error: 'Failed to get file' });
    }
};
exports.getFile = getFile;
const uploadFile = async (req, res) => {
    try {
        const userId = req.userId;
        const { folderId } = req.body;
        const file = req.file;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        if (!file) {
            res.status(400).json({ error: 'No file provided' });
            return;
        }
        // Get Telegram client
        const client = await (0, telegramController_1.getTelegramClient)(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured. Please set up Telegram first.' });
            return;
        }
        // Get user's channel ID
        const config = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (!config) {
            res.status(400).json({ error: 'Telegram configuration not found' });
            return;
        }
        // Upload file to Telegram
        const result = await client.sendFile(config.channelId, {
            file: file.path,
            caption: `📁 ${file.originalname}`,
            forceDocument: true,
        });
        // Get the file ID from the message
        const message = result;
        const telegramFileId = message.document
            ? message.document.id.toString()
            : message.id.toString();
        // Verify folder belongs to user if provided
        if (folderId) {
            const folder = await prisma_1.default.folder.findFirst({
                where: { id: folderId, userId },
            });
            if (!folder) {
                res.status(404).json({ error: 'Folder not found' });
                return;
            }
        }
        // Get unique filename (auto-rename if duplicate)
        const uniqueFilename = await getUniqueFilename(file.originalname, folderId || null, userId);
        // Save file metadata to database
        const savedFile = await prisma_1.default.file.create({
            data: {
                name: uniqueFilename,
                size: BigInt(file.size),
                mimeType: file.mimetype,
                telegramFileId,
                telegramMsgId: message.id,
                folderId: folderId || null,
                userId,
            },
        });
        // Clean up temp file
        fs_1.default.unlinkSync(file.path);
        res.status(201).json({
            file: {
                ...savedFile,
                size: savedFile.size.toString(),
            },
            message: 'File uploaded successfully',
        });
    }
    catch (error) {
        console.error('Upload file error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
};
exports.uploadFile = uploadFile;
const downloadFile = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const file = await prisma_1.default.file.findFirst({
            where: { id, userId },
            include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
        });
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        // Handle chunked files
        if (file.isChunked) {
            if (!file.chunks || file.chunks.length === 0) {
                res.status(400).json({ error: 'Chunked file has no chunks' });
                return;
            }
            // Get Telegram client
            const client = await (0, telegramController_1.getTelegramClient)(userId);
            if (!client) {
                res.status(400).json({ error: 'Telegram not configured' });
                return;
            }
            const config = await prisma_1.default.telegramConfig.findUnique({
                where: { userId },
            });
            if (!config) {
                res.status(400).json({ error: 'Telegram configuration not found' });
                return;
            }
            // Set headers for streaming
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
            res.setHeader('Content-Length', file.size.toString());
            // Use Python service for streaming download (memory-efficient)
            const { batchDownloadFromTelegramStream } = await Promise.resolve().then(() => __importStar(require('../lib/pythonService')));
            const messageIds = file.chunks.map((c) => c.telegramMsgId);
            const { stream } = await batchDownloadFromTelegramStream({
                botToken: config.botToken,
                channelId: config.channelId,
                apiId: config.apiId,
                apiHash: config.apiHash,
            }, messageIds);
            // Pipe stream directly to client (memory-efficient)
            stream.pipe(res);
            return;
        }
        // Standard file download (non-chunked)
        if (!file.telegramMsgId) {
            res.status(400).json({ error: 'File has no Telegram message ID' });
            return;
        }
        // Get Telegram client
        const client = await (0, telegramController_1.getTelegramClient)(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured' });
            return;
        }
        // Get user's channel ID
        const config = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (!config) {
            res.status(400).json({ error: 'Telegram configuration not found' });
            return;
        }
        // Get messages from channel to find the file
        const messages = await client.getMessages(config.channelId, {
            ids: [file.telegramMsgId],
        });
        if (!messages || messages.length === 0) {
            res.status(404).json({ error: 'File not found on Telegram' });
            return;
        }
        const message = messages[0];
        if (!message.document && !message.media) {
            res.status(404).json({ error: 'No file attached to message' });
            return;
        }
        // Download the file
        const tempDir = path_1.default.join(process.cwd(), 'temp');
        if (!fs_1.default.existsSync(tempDir)) {
            fs_1.default.mkdirSync(tempDir, { recursive: true });
        }
        const tempPath = path_1.default.join(tempDir, `${Date.now()}_${file.name}`);
        const buffer = await client.downloadMedia(message, {});
        if (!buffer) {
            res.status(500).json({ error: 'Failed to download file from Telegram' });
            return;
        }
        // Set response headers and send file
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.send(buffer);
    }
    catch (error) {
        console.error('Download file error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
};
exports.downloadFile = downloadFile;
const deleteFile = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const file = await prisma_1.default.file.findFirst({
            where: { id, userId },
            include: { chunks: true },
        });
        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        // Try to delete from Telegram via Bot HTTP API (lightweight, no MTProto needed)
        try {
            const config = await prisma_1.default.telegramConfig.findUnique({
                where: { userId },
            });
            if (config) {
                const { deleteFileFromTelegram } = await Promise.resolve().then(() => __importStar(require('../lib/telegramBotApi')));
                if (file.isChunked && file.chunks.length > 0) {
                    // Delete all chunks
                    const msgIds = file.chunks.map((c) => c.telegramMsgId);
                    await deleteFileFromTelegram(config.botToken, config.channelId, msgIds);
                }
                else if (file.telegramMsgId) {
                    // Delete single file
                    await deleteFileFromTelegram(config.botToken, config.channelId, file.telegramMsgId);
                }
            }
        }
        catch (telegramError) {
            console.warn('Failed to delete from Telegram:', telegramError);
            // Continue with database deletion even if Telegram deletion fails
        }
        // Delete from database
        await prisma_1.default.file.delete({
            where: { id },
        });
        res.json({ message: 'File deleted successfully' });
    }
    catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
};
exports.deleteFile = deleteFile;
//# sourceMappingURL=fileController.js.map