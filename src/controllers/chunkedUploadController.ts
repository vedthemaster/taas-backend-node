import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { getTelegramClient } from './telegramController';
import { Api } from 'telegram';
import fs from 'fs';
import path from 'path';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const CHUNK_THRESHOLD = 100 * 1024 * 1024; // 100 MB

// Helper to generate unique filename for duplicates
const getUniqueFilename = async (
    originalName: string,
    folderId: string | null,
    userId: string
): Promise<string> => {
    const lastDotIndex = originalName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName;
    const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : '';

    const existingFile = await prisma.file.findFirst({
        where: { name: originalName, folderId, userId },
    });

    if (!existingFile) return originalName;

    let counter = 1;
    let newName = `${baseName} (${counter})${extension}`;

    while (true) {
        const exists = await prisma.file.findFirst({
            where: { name: newName, folderId, userId },
        });
        if (!exists) return newName;
        counter++;
        newName = `${baseName} (${counter})${extension}`;
    }
};

/**
 * Initialize a chunked upload
 * POST /api/files/upload/init
 */
export const initChunkedUpload = async (req: AuthRequest, res: Response): Promise<void> => {
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
            const folder = await prisma.folder.findFirst({
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
        const file = await prisma.file.create({
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
    } catch (error) {
        console.error('Init chunked upload error:', error);
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
};

/**
 * Upload a single chunk
 * POST /api/files/upload/chunk/:uploadId
 */
export const uploadChunk = async (req: AuthRequest, res: Response): Promise<void> => {
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
        const file = await prisma.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Check if chunk already exists
        const existingChunk = await prisma.fileChunk.findUnique({
            where: { fileId_chunkIndex: { fileId: uploadId, chunkIndex } },
        });

        if (existingChunk) {
            // Chunk already uploaded, skip
            fs.unlinkSync(chunk.path);
            res.json({
                chunkIndex,
                status: 'already_uploaded',
                uploadedChunks: await prisma.fileChunk.count({ where: { fileId: uploadId } }),
                totalChunks: file.totalChunks,
            });
            return;
        }

        // Get Telegram client
        const client = await getTelegramClient(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (!config) {
            res.status(400).json({ error: 'Telegram configuration not found' });
            return;
        }

        // Upload chunk to Telegram
        const result = await client.sendFile(config.channelId, {
            file: chunk.path,
            caption: `📁 ${file.name} - Chunk ${chunkIndex + 1}/${file.totalChunks}`,
            forceDocument: true,
        });

        const message = result as Api.Message;
        const telegramFileId = message.document
            ? (message.document as any).id.toString()
            : message.id.toString();

        // Save chunk metadata
        await prisma.fileChunk.create({
            data: {
                fileId: uploadId,
                chunkIndex,
                telegramFileId,
                telegramMsgId: message.id,
                size: BigInt(chunk.size),
            },
        });

        // Clean up temp file
        fs.unlinkSync(chunk.path);

        const uploadedChunks = await prisma.fileChunk.count({ where: { fileId: uploadId } });

        res.json({
            chunkIndex,
            status: 'uploaded',
            uploadedChunks,
            totalChunks: file.totalChunks,
            progress: Math.round((uploadedChunks / (file.totalChunks || 1)) * 100),
        });
    } catch (error) {
        console.error('Upload chunk error:', error);
        res.status(500).json({ error: 'Failed to upload chunk' });
    }
};

/**
 * Complete a chunked upload
 * POST /api/files/upload/complete/:uploadId
 */
export const completeChunkedUpload = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Verify file belongs to user
        const file = await prisma.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Verify all chunks are uploaded
        const uploadedChunks = await prisma.fileChunk.count({ where: { fileId: uploadId } });

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
    } catch (error) {
        console.error('Complete chunked upload error:', error);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
};

/**
 * Cancel/abort a chunked upload
 * DELETE /api/files/upload/:uploadId
 */
export const cancelChunkedUpload = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { uploadId } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Verify file belongs to user
        const file = await prisma.file.findFirst({
            where: { id: uploadId, userId, isChunked: true },
            include: { chunks: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Try to delete chunks from Telegram
        try {
            const client = await getTelegramClient(userId);
            const config = await prisma.telegramConfig.findUnique({
                where: { userId },
            });

            if (client && config && file.chunks.length > 0) {
                const msgIds = file.chunks.map(c => c.telegramMsgId);
                await client.deleteMessages(config.channelId, msgIds, { revoke: true });
            }
        } catch (telegramError) {
            console.warn('Failed to delete chunks from Telegram:', telegramError);
        }

        // Delete file (cascades to chunks)
        await prisma.file.delete({ where: { id: uploadId } });

        res.json({ success: true, message: 'Upload cancelled' });
    } catch (error) {
        console.error('Cancel chunked upload error:', error);
        res.status(500).json({ error: 'Failed to cancel upload' });
    }
};

/**
 * Download a chunked file (streaming)
 * GET /api/files/:id/download/stream
 */
export const downloadChunkedFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const file = await prisma.file.findFirst({
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

        // Get Telegram client
        const client = await getTelegramClient(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
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

        // Stream each chunk
        for (let i = 0; i < file.chunks.length; i++) {
            const chunk = file.chunks[i];

            // Get message from Telegram
            const messages = await client.getMessages(config.channelId, {
                ids: [chunk.telegramMsgId],
            });

            if (!messages || messages.length === 0) {
                throw new Error(`Chunk ${i} not found on Telegram`);
            }

            const message = messages[0];
            const buffer = await client.downloadMedia(message, {});

            if (!buffer) {
                throw new Error(`Failed to download chunk ${i}`);
            }

            // Write chunk to response
            res.write(buffer);
        }

        res.end();
    } catch (error) {
        console.error('Download chunked file error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    }
};
