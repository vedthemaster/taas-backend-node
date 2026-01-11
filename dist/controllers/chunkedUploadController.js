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
exports.downloadChunkedFile = exports.cancelChunkedUpload = exports.completeChunkedUpload = exports.uploadChunk = exports.initChunkedUpload = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const pythonService_1 = require("../lib/pythonService");
const fs_1 = __importDefault(require("fs"));
const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const CHUNK_THRESHOLD = 100 * 1024 * 1024; // 100 MB
// Helper to generate unique filename for duplicates
const getUniqueFilename = async (originalName, folderId, userId) => {
    const lastDotIndex = originalName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName;
    const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : '';
    const existingFile = await prisma_1.default.file.findFirst({
        where: { name: originalName, folderId, userId },
    });
    if (!existingFile)
        return originalName;
    let counter = 1;
    let newName = `${baseName} (${counter})${extension}`;
    while (true) {
        const exists = await prisma_1.default.file.findFirst({
            where: { name: newName, folderId, userId },
        });
        if (!exists)
            return newName;
        counter++;
        newName = `${baseName} (${counter})${extension}`;
    }
};
/**
 * Initialize a chunked upload
 * POST /api/files/upload/init
 */
const initChunkedUpload = async (req, res) => {
    try {
        const userId = req.userId;
        const { filename, size, mimeType, folderId } = req.body;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        if (!filename || !size || !mimeType) {
            res.status(400).json({ error: 'Missing required fields: filename, size, mimeType' });
            return;
        }
        const fileSize = BigInt(size);
        const totalChunks = Math.ceil(Number(size) / CHUNK_SIZE);
        // Verify folder if provided
        if (folderId) {
            const folder = await prisma_1.default.folder.findFirst({
                where: { id: folderId, userId },
            });
            if (!folder) {
                res.status(404).json({ error: 'Folder not found' });
                return;
            }
        }
        // Get unique filename
        const uniqueFilename = await getUniqueFilename(filename, folderId || null, userId);
        // Create file record with isChunked = true
        const file = await prisma_1.default.file.create({
            data: {
                name: uniqueFilename,
                size: fileSize,
                mimeType,
                isChunked: true,
                totalChunks,
                folderId: folderId || null,
                userId,
            },
        });
        res.status(201).json({
            uploadId: file.id,
            totalChunks,
            chunkSize: CHUNK_SIZE,
            filename: uniqueFilename,
        });
    }
    catch (error) {
        console.error('Init chunked upload error:', error);
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
};
exports.initChunkedUpload = initChunkedUpload;
/**
 * Upload a single chunk
 * POST /api/files/upload/chunk/:uploadId
 */
const uploadChunk = async (req, res) => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params;
        const chunkIndex = parseInt(req.body.chunkIndex);
        const chunk = req.file;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        if (!chunk) {
            res.status(400).json({ error: 'No chunk data provided' });
            return;
        }
        if (isNaN(chunkIndex) || chunkIndex < 0) {
            res.status(400).json({ error: 'Invalid chunk index' });
            return;
        }
        // Verify file belongs to user
        const file = await prisma_1.default.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
        });
        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }
        // Check if chunk already exists
        const existingChunk = await prisma_1.default.fileChunk.findUnique({
            where: { fileId_chunkIndex: { fileId: uploadId, chunkIndex } },
        });
        if (existingChunk) {
            // Chunk already uploaded, skip
            fs_1.default.unlinkSync(chunk.path);
            res.json({
                chunkIndex,
                status: 'already_uploaded',
                uploadedChunks: await prisma_1.default.fileChunk.count({ where: { fileId: uploadId } }),
                totalChunks: file.totalChunks,
            });
            return;
        }
        // Get Telegram config for credentials
        const config = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (!config) {
            res.status(400).json({ error: 'Telegram configuration not found' });
            return;
        }
        // Upload chunk to Telegram via Python service
        const result = await (0, pythonService_1.uploadToTelegram)({
            botToken: config.botToken,
            channelId: config.channelId,
            apiId: config.apiId,
            apiHash: config.apiHash,
        }, chunk.path, `📁 ${file.name} - Chunk ${chunkIndex + 1}/${file.totalChunks}`);
        // Save chunk metadata
        await prisma_1.default.fileChunk.create({
            data: {
                fileId: uploadId,
                chunkIndex,
                telegramFileId: result.file_id,
                telegramMsgId: result.message_id,
                size: BigInt(chunk.size),
            },
        });
        // Note: Python service deletes the temp file with delete_after: true
        const uploadedChunks = await prisma_1.default.fileChunk.count({ where: { fileId: uploadId } });
        res.json({
            chunkIndex,
            status: 'uploaded',
            uploadedChunks,
            totalChunks: file.totalChunks,
            progress: Math.round((uploadedChunks / (file.totalChunks || 1)) * 100),
        });
    }
    catch (error) {
        console.error('Upload chunk error:', error);
        res.status(500).json({ error: 'Failed to upload chunk' });
    }
};
exports.uploadChunk = uploadChunk;
/**
 * Complete a chunked upload
 * POST /api/files/upload/complete/:uploadId
 */
const completeChunkedUpload = async (req, res) => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        // Verify file belongs to user
        const file = await prisma_1.default.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
        });
        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }
        // Verify all chunks are uploaded
        const uploadedChunks = await prisma_1.default.fileChunk.count({ where: { fileId: uploadId } });
        if (uploadedChunks !== file.totalChunks) {
            res.status(400).json({
                error: 'Upload incomplete',
                uploadedChunks,
                expectedChunks: file.totalChunks,
            });
            return;
        }
        res.json({
            success: true,
            file: {
                id: file.id,
                name: file.name,
                size: file.size.toString(),
                mimeType: file.mimeType,
                isChunked: file.isChunked,
                totalChunks: file.totalChunks,
            },
        });
    }
    catch (error) {
        console.error('Complete chunked upload error:', error);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
};
exports.completeChunkedUpload = completeChunkedUpload;
/**
 * Cancel/abort a chunked upload
 * DELETE /api/files/upload/:uploadId
 */
const cancelChunkedUpload = async (req, res) => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        // Verify file belongs to user
        const file = await prisma_1.default.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
            include: { chunks: true },
        });
        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }
        // Delete chunks from Telegram via Bot HTTP API (lightweight, rate-limited)
        if (file.chunks.length > 0) {
            try {
                const config = await prisma_1.default.telegramConfig.findUnique({
                    where: { userId },
                });
                if (config) {
                    const { deleteFileFromTelegram } = await Promise.resolve().then(() => __importStar(require('../lib/telegramBotApi')));
                    const msgIds = file.chunks.map((c) => c.telegramMsgId);
                    await deleteFileFromTelegram(config.botToken, config.channelId, msgIds);
                }
            }
            catch (telegramError) {
                console.warn('Failed to delete chunks from Telegram:', telegramError);
            }
        }
        // Delete file (cascades to chunks)
        await prisma_1.default.file.delete({ where: { id: uploadId } });
        res.json({ success: true, message: 'Upload cancelled' });
    }
    catch (error) {
        console.error('Cancel chunked upload error:', error);
        res.status(500).json({ error: 'Failed to cancel upload' });
    }
};
exports.cancelChunkedUpload = cancelChunkedUpload;
/**
 * Download a chunked file (streaming via Python service)
 * GET /api/files/:id/download/stream
 */
const downloadChunkedFile = async (req, res) => {
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
        if (!file.isChunked || file.chunks.length === 0) {
            res.status(400).json({ error: 'File is not chunked or has no chunks' });
            return;
        }
        const config = await prisma_1.default.telegramConfig.findUnique({
            where: { userId },
        });
        if (!config) {
            res.status(400).json({ error: 'Telegram configuration not found' });
            return;
        }
        // Set streaming headers
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Length', file.size.toString());
        res.setHeader('X-Total-Chunks', file.chunks.length.toString());
        // Use Python service for batch download (parallel + fast)
        const { batchDownloadFromTelegram } = await Promise.resolve().then(() => __importStar(require('../lib/pythonService')));
        const messageIds = file.chunks.map((c) => c.telegramMsgId);
        const buffer = await batchDownloadFromTelegram({
            botToken: config.botToken,
            channelId: config.channelId,
            apiId: config.apiId,
            apiHash: config.apiHash,
        }, messageIds);
        res.send(buffer);
    }
    catch (error) {
        console.error('Download chunked file error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    }
};
exports.downloadChunkedFile = downloadChunkedFile;
//# sourceMappingURL=chunkedUploadController.js.map