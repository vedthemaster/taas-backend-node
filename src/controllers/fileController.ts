import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
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
        const { folderId, search, sortBy, sortOrder } = req.query;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Build where clause
        const where: any = {
            userId,
            folderId: folderId ? String(folderId) : null,
        };

        // Add search filter
        if (search && typeof search === 'string' && search.trim()) {
            where.name = {
                contains: search.trim(),
                mode: 'insensitive',
            };
        }

        // Build orderBy clause
        let orderBy: any = { name: 'asc' };
        if (sortBy) {
            const order = sortOrder === 'desc' ? 'desc' : 'asc';
            switch (sortBy) {
                case 'name':
                    orderBy = { name: order };
                    break;
                case 'date':
                    orderBy = { createdAt: order };
                    break;
                case 'size':
                    orderBy = { size: order };
                    break;
            }
        }

        const files = await prisma.file.findMany({
            where,
            orderBy,
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
            where: { id: String(id), userId },
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

        // Get Telegram config with bots
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: { where: { isActive: true } } },
        });

        if (!config || (config as any).bots.length === 0) {
            res.status(400).json({ error: 'No bots configured. Please add at least one bot in settings.' });
            return;
        }

        const botTokens = (config as any).bots.map((b: any) => b.botToken);

        // Upload file to Telegram via Python service
        const { uploadToTelegram } = await import('../lib/pythonService');
        const result = await uploadToTelegram(
            {
                channelId: config.channelId,
                botTokens,
            },
            file.path,
            `📁 ${file.originalname}`
        );

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
                telegramFileId: result.file_id,
                telegramMsgId: result.message_id,
                folderId: folderId || null,
                userId,
            },
        });

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
            where: { id: String(id), userId },
            include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
        });

        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // Get Telegram config with bots
        const config = await prisma.telegramConfig.findUnique({
            where: { userId },
            include: { bots: { where: { isActive: true } } },
        });

        if (!config || (config as any).bots.length === 0) {
            res.status(400).json({ error: 'No bots configured' });
            return;
        }

        const botTokens = (config as any).bots.map((b: any) => b.botToken);

        // Handle chunked files
        if (file.isChunked) {
            if (!(file as any).chunks || (file as any).chunks.length === 0) {
                res.status(400).json({ error: 'Chunked file has no chunks' });
                return;
            }

            // Set headers for streaming
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
            res.setHeader('Content-Length', file.size.toString());

            // Use Python service for streaming download by file_ids (memory-efficient)
            const { downloadByFileIdsStream } = await import('../lib/pythonService');

            // Use file_id for downloads (stored during upload)
            const fileIds = (file as any).chunks.map((c: any) => c.telegramFileId);

            const { stream } = await downloadByFileIdsStream(
                {
                    channelId: config.channelId,
                    botTokens,
                },
                fileIds
            );

            // Pipe stream directly to client (memory-efficient)
            stream.pipe(res);
            return;
        }

        // Standard file download (non-chunked) - use Python service with single file_id
        if (!file.telegramFileId) {
            res.status(400).json({ error: 'File has no Telegram file ID' });
            return;
        }

        // Set response headers
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Length', file.size.toString());

        // Use Python service for single file download
        const { downloadByFileIdsStream } = await import('../lib/pythonService');

        const { stream } = await downloadByFileIdsStream(
            {
                channelId: config.channelId,
                botTokens,
            },
            [file.telegramFileId] // Single file as array
        );

        stream.pipe(res);
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
            where: { id: String(id), userId },
            include: { chunks: true },
        });

        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // Try to delete from Telegram via Bot HTTP API (lightweight, no MTProto needed)
        try {
            const config = await prisma.telegramConfig.findUnique({
                where: { userId },
                include: { bots: { where: { isActive: true } } },
            });

            if (config) {
                const { deleteFileFromTelegram } = await import('../lib/telegramBotApi');
                // Get botToken from config or fall back to first active bot
                const botToken = config.botToken || (config.bots.length > 0 ? config.bots[0].botToken : null);

                if (botToken) {
                    if (file.isChunked && (file as any).chunks.length > 0) {
                        // Delete all chunks
                        const msgIds = (file as any).chunks.map((c: any) => c.telegramMsgId);
                        await deleteFileFromTelegram(botToken, config.channelId, msgIds);
                    } else if (file.telegramMsgId) {
                        // Delete single file
                        await deleteFileFromTelegram(botToken, config.channelId, file.telegramMsgId);
                    }
                }
            }
        } catch (telegramError) {
            console.warn('Failed to delete from Telegram:', telegramError);
            // Continue with database deletion even if Telegram deletion fails
        }

        // Delete from database
        await prisma.file.delete({
            where: { id: String(id) },
        });

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
};

// Move file to different folder
export const moveFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { targetFolderId } = req.body; // null for root folder

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Verify file exists and belongs to user
        const file = await prisma.file.findFirst({
            where: { id: String(id), userId },
        });

        if (!file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        // If target folder specified, verify it exists and belongs to user
        if (targetFolderId) {
            const targetFolder = await prisma.folder.findFirst({
                where: { id: String(targetFolderId), userId },
            });

            if (!targetFolder) {
                res.status(404).json({ error: 'Target folder not found' });
                return;
            }
        }

        // Update file's folder
        const updatedFile = await prisma.file.update({
            where: { id: String(id) },
            data: { folderId: targetFolderId ? String(targetFolderId) : null },
        });

        res.json({
            ...updatedFile,
            size: updatedFile.size.toString(),
        });
    } catch (error) {
        console.error('Move file error:', error);
        res.status(500).json({ error: 'Failed to move file' });
    }
};
