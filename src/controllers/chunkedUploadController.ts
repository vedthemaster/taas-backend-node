import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { uploadToTelegram } from '../lib/pythonService';
import fs from 'fs';
import path from 'path';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const CHUNK_THRESHOLD = 16 * 1024 * 1024; // 16 MB - all files >16MB get chunked

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

        // Check file size limit for system bot users (100MB)
        const SYSTEM_BOT_LIMIT = 100 * 1024 * 1024; // 100MB
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
        });

        if (config?.useSystemBots && Number(size) > SYSTEM_BOT_LIMIT) {
            res.status(413).json({
                error: 'File size exceeds 100MB limit',
                message: 'You are using shared system bots which have a 100MB file size limit. To upload larger files, please set up your own bot and channel in Settings.',
                maxSize: SYSTEM_BOT_LIMIT,
                useSystemBots: true,
            });
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
            where: { id: String(uploadId), userId, isChunked: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Check if chunk already exists
        const existingChunk = await prisma.fileChunk.findUnique({
            where: { fileId_chunkIndex: { fileId: String(uploadId), chunkIndex } },
        });

        if (existingChunk) {
            // Chunk already uploaded, skip
            fs.unlinkSync(chunk.path);
            res.json({
                chunkIndex,
                status: 'already_uploaded',
                uploadedChunks: await prisma.fileChunk.count({ where: { fileId: String(uploadId) } }),
                totalChunks: file.totalChunks,
            });
            return;
        }

        // Get Telegram config with bots
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: { where: { isActive: true } } },
        });

        if (!config) {
            res.status(400).json({ error: 'No Telegram configuration found. Please complete setup.' });
            return;
        }

        // Get bot tokens - use system bots if user has useSystemBots=true
        let botTokens: string[];
        if (config.useSystemBots) {
            const { getSystemBotTokens } = await import('./botController');
            botTokens = getSystemBotTokens();
            if (botTokens.length === 0) {
                res.status(500).json({ error: 'System bots not configured. Please contact administrator.' });
                return;
            }
        } else {
            if ((config as any).bots.length === 0) {
                res.status(400).json({ error: 'No bots configured. Please add at least one bot.' });
                return;
            }
            botTokens = (config as any).bots.map((b: any) => b.botToken);
        }

        // Upload chunk to Telegram via Python service (multi-bot)
        const result = await uploadToTelegram(
            {
                channelId: config.channelId,
                botTokens,
            },
            chunk.path,
            `📁 ${file.name} - Chunk ${chunkIndex + 1}/${file.totalChunks}`
        );

        // Save chunk metadata
        await prisma.fileChunk.create({
            data: {
                fileId: String(uploadId),
                chunkIndex,
                telegramFileId: result.file_id,
                telegramMsgId: result.message_id,
                size: BigInt(chunk.size),
            },
        });

        // Note: Python service deletes the temp file with delete_after: true

        const uploadedChunks = await prisma.fileChunk.count({ where: { fileId: String(uploadId) } });

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
            where: { id: String(uploadId), userId, isChunked: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Verify all chunks are uploaded
        const uploadedChunks = await prisma.fileChunk.count({ where: { fileId: String(uploadId) } });

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
            where: { id: String(uploadId), userId, isChunked: true },
            include: { chunks: true },
        });

        if (!file) {
            res.status(404).json({ error: 'Upload not found' });
            return;
        }

        // Delete chunks from Telegram via Bot HTTP API (if any uploaded)
        if ((file as any).chunks.length > 0) {
            try {
                const config = await prisma.telegramConfig.findUnique({
                    where: { userId },
                    include: { bots: { where: { isActive: true } } },
                });

                if (config && (config as any).bots.length > 0) {
                    const { deleteFileFromTelegram } = await import('../lib/telegramBotApi');
                    const firstBotToken = (config as any).bots[0].botToken;
                    const msgIds = (file as any).chunks.map((c: any) => c.telegramMsgId);
                    await deleteFileFromTelegram(firstBotToken, config.channelId, msgIds);
                }
            } catch (telegramError) {
                console.warn('Failed to delete chunks from Telegram:', telegramError);
            }
        }

        // Clean up any remaining temp files for this upload
        const tempDir = path.join(process.cwd(), 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            const uploadPrefix = file.id;
            for (const tempFile of files) {
                if (tempFile.includes(uploadPrefix)) {
                    try {
                        fs.unlinkSync(path.join(tempDir, tempFile));
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                }
            }
        }

        // Delete file (cascades to chunks)
        await prisma.file.delete({ where: { id: String(uploadId) } });

        res.json({ success: true, message: 'Upload cancelled' });
    } catch (error) {
        console.error('Cancel chunked upload error:', error);
        res.status(500).json({ error: 'Failed to cancel upload' });
    }
};

/**
 * Download a chunked file (streaming via Python service)
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
            where: { id: String(id), userId },
            include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
        });

        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        if (!file.isChunked || (file as any).chunks.length === 0) {
            res.status(400).json({ error: 'File is not chunked or has no chunks' });
            return;
        }

        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: { where: { isActive: true } } },
        });

        if (!config) {
            res.status(400).json({ error: 'No Telegram configuration found' });
            return;
        }

        // Get bot tokens - use system bots if user has useSystemBots=true
        let botTokens: string[];
        if (config.useSystemBots) {
            const { getSystemBotTokens } = await import('./botController');
            botTokens = getSystemBotTokens();
            if (botTokens.length === 0) {
                res.status(500).json({ error: 'System bots not configured' });
                return;
            }
        } else {
            if ((config as any).bots.length === 0) {
                res.status(400).json({ error: 'No bots configured' });
                return;
            }
            botTokens = (config as any).bots.map((b: any) => b.botToken);
        }

        // Set streaming headers
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Length', file.size.toString());
        res.setHeader('X-Total-Chunks', (file as any).chunks.length.toString());

        // Use Python service for file_id based streaming download
        const { downloadByFileIdsStream } = await import('../lib/pythonService');

        const fileIds = (file as any).chunks.map((c: any) => c.telegramFileId);

        const { stream } = await downloadByFileIdsStream(
            {
                channelId: config.channelId,
                botTokens,
            },
            fileIds
        );

        stream.pipe(res);
    } catch (error) {
        console.error('Download chunked file error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    }
};
