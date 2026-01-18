import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { uploadChunkToTelegram, downloadFileFromTelegram, deleteMessageFromTelegram } from '../lib/telegramStreamApi';

const CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB (Telegram download limit is 20MB)

// In-memory upload session store
// Key: uploadId, Value: session data
interface UploadSession {
    userId: string;
    filename: string;
    size: bigint;
    mimeType: string;
    folderId: string | null;
    totalChunks: number;
    chunks: Map<number, {
        telegramFileId: string;
        telegramMsgId: number;
        channelId: string;
        size: bigint;
    }>;
    createdAt: Date;
}

const uploadSessions: Map<string, UploadSession> = new Map();

// Cleanup old sessions (older than 24 hours)
const cleanupOldSessions = () => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    for (const [id, session] of uploadSessions.entries()) {
        if (now - session.createdAt.getTime() > maxAge) {
            uploadSessions.delete(id);
        }
    }
};

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

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
 * Creates an in-memory session, NOT a database record
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

        // Generate upload ID (NOT stored in database yet)
        const uploadId = uuidv4();

        // Create in-memory session
        const session: UploadSession = {
            userId,
            filename,
            size: fileSize,
            mimeType,
            folderId: folderId || null,
            totalChunks,
            chunks: new Map(),
            createdAt: new Date(),
        };

        uploadSessions.set(uploadId, session);

        console.log(`📤 INIT UPLOAD: ${filename} (${(Number(size) / (1024 * 1024)).toFixed(2)} MB, ${totalChunks} chunks)`);

        res.json({
            uploadId,
            filename,
            totalChunks,
            chunkSize: CHUNK_SIZE,
        });
    } catch (error) {
        console.error('Init chunked upload error:', error);
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
};

/**
 * Upload a chunk (memory-based, streams directly to Telegram)
 * POST /api/files/upload/chunk/:uploadId
 * Stores chunk info in memory session, NOT in database
 */
export const uploadChunk = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const uploadId = String(req.params.uploadId);
        const chunkIndex = parseInt(req.body.chunkIndex);
        const chunk = req.file;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!chunk || !chunk.buffer) {
            res.status(400).json({ error: 'No chunk data provided' });
            return;
        }

        if (isNaN(chunkIndex) || chunkIndex < 0) {
            res.status(400).json({ error: 'Invalid chunk index' });
            return;
        }

        // Get session from memory
        const session = uploadSessions.get(uploadId);
        if (!session || session.userId !== userId) {
            res.status(404).json({ error: 'Upload session not found or expired' });
            return;
        }

        // Check if chunk already uploaded
        if (session.chunks.has(chunkIndex)) {
            res.json({
                chunkIndex,
                status: 'already_uploaded',
                uploadedChunks: session.chunks.size,
                totalChunks: session.totalChunks,
            });
            return;
        }

        // Get Telegram config with bots and channels
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: {
                bots: { where: { isActive: true } },
                channels: { where: { isActive: true } },
            },
        });

        if (!config) {
            res.status(400).json({ error: 'No Telegram configuration found. Please complete setup.' });
            return;
        }

        // Get bot tokens
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

        // Build channel list
        const channelIds = [config.channelId];
        if ((config as any).channels && (config as any).channels.length > 0) {
            for (const ch of (config as any).channels) {
                if (!channelIds.includes(ch.channelId)) {
                    channelIds.push(ch.channelId);
                }
            }
        }

        // Get available bot+channel slot
        let botToken: string;
        let targetChannelId: string;

        if (channelIds.length > 1) {
            const { getMultiChannelBotPool } = await import('../lib/telegramBotPool');
            const multiPool = getMultiChannelBotPool(botTokens, channelIds);
            const slot = await multiPool.getAvailableSlot();
            botToken = slot.botToken;
            targetChannelId = slot.channelId;
        } else {
            const { getBotPool } = await import('../lib/telegramBotPool');
            const botPool = getBotPool(config.channelId, botTokens);
            botToken = await botPool.getAvailableBot();
            targetChannelId = config.channelId;
        }

        // Upload chunk to Telegram
        const caption = `📁 ${session.filename} - Chunk ${chunkIndex + 1}/${session.totalChunks}`;
        const result = await uploadChunkToTelegram(
            chunk.buffer,
            targetChannelId,
            botToken,
            `chunk_${chunkIndex}.bin`,
            caption
        );

        // Store chunk info in session (NOT in database)
        session.chunks.set(chunkIndex, {
            telegramFileId: result.fileId,
            telegramMsgId: result.messageId,
            channelId: targetChannelId,
            size: BigInt(chunk.size),
        });

        console.log(`  ✅ Chunk ${chunkIndex + 1}/${session.totalChunks} uploaded (${(chunk.size / (1024 * 1024)).toFixed(2)} MB)`);

        res.json({
            chunkIndex,
            status: 'uploaded',
            uploadedChunks: session.chunks.size,
            totalChunks: session.totalChunks,
            progress: Math.round((session.chunks.size / session.totalChunks) * 100),
        });
    } catch (error) {
        console.error('Upload chunk error:', error);
        res.status(500).json({ error: 'Failed to upload chunk' });
    }
};

/**
 * Complete a chunked upload
 * POST /api/files/upload/complete/:uploadId
 * Creates the file and chunk records in database ONLY when complete
 */
export const completeChunkedUpload = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const uploadId = String(req.params.uploadId);

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Get session from memory
        const session = uploadSessions.get(uploadId);
        if (!session || session.userId !== userId) {
            res.status(404).json({ error: 'Upload session not found or expired' });
            return;
        }

        // Check all chunks uploaded
        if (session.chunks.size < session.totalChunks) {
            res.status(400).json({
                error: 'Upload incomplete',
                uploadedChunks: session.chunks.size,
                totalChunks: session.totalChunks,
            });
            return;
        }

        // Get unique filename (check again at completion time)
        const uniqueFilename = await getUniqueFilename(session.filename, session.folderId, userId);

        // Create file record in database
        const file = await prisma.file.create({
            data: {
                name: uniqueFilename,
                size: session.size,
                mimeType: session.mimeType,
                folderId: session.folderId,
                userId,
                isChunked: true,
                totalChunks: session.totalChunks,
            },
        });

        // Create chunk records in database
        const chunkData = Array.from(session.chunks.entries()).map(([index, chunk]) => ({
            fileId: file.id,
            chunkIndex: index,
            telegramFileId: chunk.telegramFileId,
            telegramMsgId: chunk.telegramMsgId,
            channelId: chunk.channelId,
            size: chunk.size,
        }));

        await prisma.fileChunk.createMany({
            data: chunkData,
        });

        // Remove session from memory
        uploadSessions.delete(uploadId);

        console.log(`✅ UPLOAD COMPLETE: ${uniqueFilename}`);

        res.json({
            file: {
                id: file.id,
                name: file.name,
                size: file.size.toString(),
                mimeType: file.mimeType,
                createdAt: file.createdAt,
            },
            message: 'Upload completed successfully',
        });
    } catch (error) {
        console.error('Complete chunked upload error:', error);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
};

/**
 * Cancel a chunked upload
 * DELETE /api/files/upload/:uploadId
 * Deletes chunks from Telegram but NOT from database (since nothing was stored)
 */
export const cancelChunkedUpload = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const uploadId = String(req.params.uploadId);

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Get session from memory
        const session = uploadSessions.get(uploadId);
        if (!session || session.userId !== userId) {
            res.status(404).json({ error: 'Upload session not found or expired' });
            return;
        }

        // Try to delete chunks from Telegram
        if (session.chunks.size > 0) {
            const config = await prisma.telegramConfig.findUnique({
                where: { userId },
                include: { bots: { where: { isActive: true } } },
            });

            if (config) {
                let botToken: string | null = null;
                if (config.useSystemBots) {
                    const { getSystemBotTokens } = await import('./botController');
                    const tokens = getSystemBotTokens();
                    botToken = tokens[0] || null;
                } else if ((config as any).bots.length > 0) {
                    botToken = (config as any).bots[0].botToken;
                }

                if (botToken) {
                    for (const chunk of session.chunks.values()) {
                        try {
                            await deleteMessageFromTelegram(chunk.channelId, chunk.telegramMsgId, botToken);
                        } catch (e) {
                            console.warn('Failed to delete chunk from Telegram:', e);
                        }
                    }
                }
            }
        }

        // Remove session from memory (nothing in database to delete)
        uploadSessions.delete(uploadId);

        console.log(`🚫 UPLOAD CANCELLED: ${session.filename}`);

        res.json({ message: 'Upload cancelled' });
    } catch (error) {
        console.error('Cancel chunked upload error:', error);
        res.status(500).json({ error: 'Failed to cancel upload' });
    }
};

/**
 * Download a chunked file (streams directly from Telegram)
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

        // Get bot tokens
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
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
        res.setHeader('Content-Length', file.size.toString());
        res.setHeader('X-Total-Chunks', (file as any).chunks.length.toString());

        console.log(`📥 DOWNLOAD: ${file.name} (${(file as any).chunks.length} chunks)`);

        const { getBotPool } = await import('../lib/telegramBotPool');
        const defaultPool = getBotPool(config.channelId, botTokens);

        // Stream chunks in order
        for (const chunk of (file as any).chunks) {
            const token = await defaultPool.getAvailableBot();
            const { stream } = await downloadFileFromTelegram(chunk.telegramFileId, token);

            await new Promise<void>((resolve, reject) => {
                stream.on('data', (data: Buffer) => {
                    res.write(data);
                });
                stream.on('end', () => {
                    console.log(`  📦 Chunk ${chunk.chunkIndex + 1} streamed`);
                    resolve();
                });
                stream.on('error', reject);
            });
        }

        res.end();
        console.log(`✅ DOWNLOAD COMPLETE: ${file.name}`);
    } catch (error) {
        console.error('Download chunked file error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download file' });
        }
    }
};
