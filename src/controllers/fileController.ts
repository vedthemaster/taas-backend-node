import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { getTelegramClient } from './telegramController';
import { Api } from 'telegram';
import fs from 'fs';
import path from 'path';

// Helper to generate unique filename for duplicates
const getUniqueFilename = async (
    originalName: string,
    folderId: string | null,
    userId: string
): Promise<string> => {
    // Split name and extension
    const lastDotIndex = originalName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName;
    const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : '';

    // Check if file with same name exists
    const existingFile = await prisma.file.findFirst({
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
        const exists = await prisma.file.findFirst({
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

export const getFiles = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { folderId } = req.query;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const files = await prisma.file.findMany({
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
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: 'Failed to get files' });
    }
};

export const getFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const file = await prisma.file.findFirst({
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
    } catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({ error: 'Failed to get file' });
    }
};

export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
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
        const client = await getTelegramClient(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured. Please set up Telegram first.' });
            return;
        }

        // Get user's channel ID
        const config = await prisma.telegramConfig.findUnique({
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
        const message = result as Api.Message;
        const telegramFileId = message.document
            ? (message.document as any).id.toString()
            : message.id.toString();

        // Verify folder belongs to user if provided
        if (folderId) {
            const folder = await prisma.folder.findFirst({
                where: { id: folderId, userId },
            });
            if (!folder) {
                res.status(404).json({ error: 'Folder not found' });
                return;
            }
        }

        // Get unique filename (auto-rename if duplicate)
        const uniqueFilename = await getUniqueFilename(
            file.originalname,
            folderId || null,
            userId
        );

        // Save file metadata to database
        const savedFile = await prisma.file.create({
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
        fs.unlinkSync(file.path);

        res.status(201).json({
            file: {
                ...savedFile,
                size: savedFile.size.toString(),
            },
            message: 'File uploaded successfully',
        });
    } catch (error) {
        console.error('Upload file error:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
};

export const downloadFile = async (req: AuthRequest, res: Response): Promise<void> => {
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

        // Handle chunked files
        if (file.isChunked) {
            if (!file.chunks || file.chunks.length === 0) {
                res.status(400).json({ error: 'Chunked file has no chunks' });
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

            // Set headers for streaming
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
            res.setHeader('Content-Length', file.size.toString());

            // Download chunks in parallel (3 concurrent) and store in order
            const MAX_CONCURRENT_DOWNLOADS = 3;
            const chunkBuffers: Map<number, Buffer> = new Map();
            const chunks = [...file.chunks];
            let nextChunkToWrite = 0;
            let downloadQueue = chunks.map(c => c.chunkIndex);
            let activeDownloads = 0;

            const downloadChunk = async (chunkIndex: number): Promise<void> => {
                const chunk = chunks.find(c => c.chunkIndex === chunkIndex);
                if (!chunk) return;

                const messages = await client.getMessages(config.channelId, {
                    ids: [chunk.telegramMsgId],
                });

                if (!messages || messages.length === 0 || !messages[0]) {
                    throw new Error(`Chunk ${chunkIndex} not found on Telegram`);
                }

                const buffer = await client.downloadMedia(messages[0], {});
                if (!buffer) {
                    throw new Error(`Failed to download chunk ${chunkIndex}`);
                }

                chunkBuffers.set(chunkIndex, buffer as Buffer);
            };

            // Process and write chunks in order
            const writeAvailableChunks = () => {
                while (chunkBuffers.has(nextChunkToWrite)) {
                    const buffer = chunkBuffers.get(nextChunkToWrite)!;
                    res.write(buffer);
                    chunkBuffers.delete(nextChunkToWrite);
                    nextChunkToWrite++;
                }
            };

            // Download all chunks with concurrency limit
            const downloadAll = async () => {
                const downloadPromises: Promise<void>[] = [];

                const startNextDownload = async (): Promise<void> => {
                    while (downloadQueue.length > 0 && activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
                        const chunkIndex = downloadQueue.shift()!;
                        activeDownloads++;

                        const downloadPromise = downloadChunk(chunkIndex)
                            .then(() => {
                                activeDownloads--;
                                writeAvailableChunks();
                            })
                            .catch(err => {
                                throw err;
                            });

                        downloadPromises.push(downloadPromise);
                    }
                };

                await startNextDownload();

                // Wait for initial batch
                while (downloadPromises.length > 0 || downloadQueue.length > 0) {
                    if (downloadPromises.length > 0) {
                        await Promise.race(downloadPromises);
                        // Remove completed promises
                        const newPromises: Promise<void>[] = [];
                        for (const p of downloadPromises) {
                            const result = await Promise.race([p, Promise.resolve('pending')]);
                            if (result === 'pending') {
                                newPromises.push(p);
                            }
                        }
                        downloadPromises.length = 0;
                        downloadPromises.push(...newPromises);
                    }
                    await startNextDownload();
                }

                // Wait for all remaining downloads
                await Promise.all(downloadPromises);
                writeAvailableChunks();
            };

            await downloadAll();
            res.end();
            return;
        }

        // Standard file download (non-chunked)
        if (!file.telegramMsgId) {
            res.status(400).json({ error: 'File has no Telegram message ID' });
            return;
        }

        // Get Telegram client
        const client = await getTelegramClient(userId);
        if (!client) {
            res.status(400).json({ error: 'Telegram not configured' });
            return;
        }

        // Get user's channel ID
        const config = await prisma.telegramConfig.findUnique({
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
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempPath = path.join(tempDir, `${Date.now()}_${file.name}`);
        const buffer = await client.downloadMedia(message, {});

        if (!buffer) {
            res.status(500).json({ error: 'Failed to download file from Telegram' });
            return;
        }

        // Set response headers and send file
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Download file error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
};

export const deleteFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const file = await prisma.file.findFirst({
            where: { id, userId },
        });

        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // Try to delete from Telegram (optional - might fail if message already deleted)
        try {
            const client = await getTelegramClient(userId);
            const config = await prisma.telegramConfig.findUnique({
                where: { userId },
            });

            if (client && config) {
                await client.deleteMessages(config.channelId, [file.telegramMsgId], {
                    revoke: true,
                });
            }
        } catch (telegramError) {
            console.warn('Failed to delete from Telegram:', telegramError);
            // Continue with database deletion even if Telegram deletion fails
        }

        // Delete from database
        await prisma.file.delete({
            where: { id },
        });

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
};
