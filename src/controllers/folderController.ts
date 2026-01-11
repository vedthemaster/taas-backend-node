import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

// Helper to convert BigInt to string for JSON serialization
const serializeBigInt = (obj: any): any => {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));
};

export const getFolders = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { parentId } = req.query;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const folders = await prisma.folder.findMany({
            where: {
                userId,
                parentId: parentId ? String(parentId) : null,
            },
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: {
                        children: true,
                        files: true,
                    },
                },
            },
        });

        res.json({ folders });
    } catch (error) {
        console.error('Get folders error:', error);
        res.status(500).json({ error: 'Failed to get folders' });
    }
};

export const getFolder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const folder = await prisma.folder.findFirst({
            where: {
                id,
                userId,
            },
            include: {
                parent: {
                    select: { id: true, name: true, parentId: true },
                },
                children: {
                    orderBy: { name: 'asc' },
                    include: {
                        _count: {
                            select: { children: true, files: true },
                        },
                    },
                },
                files: {
                    orderBy: { name: 'asc' },
                },
            },
        });

        if (!folder) {
            res.status(404).json({ error: 'Folder not found' });
            return;
        }

        // Build breadcrumb path
        const breadcrumbs = [];
        let current = folder;
        breadcrumbs.unshift({ id: current.id, name: current.name });

        while (current.parent) {
            const parent = await prisma.folder.findUnique({
                where: { id: current.parent.id },
                include: { parent: { select: { id: true, name: true, parentId: true } } },
            });
            if (parent) {
                breadcrumbs.unshift({ id: parent.id, name: parent.name });
                current = parent as any;
            } else {
                break;
            }
        }

        res.json(serializeBigInt({ folder, breadcrumbs }));
    } catch (error) {
        console.error('Get folder error:', error);
        res.status(500).json({ error: 'Failed to get folder' });
    }
};

export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { name, parentId } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!name || name.trim() === '') {
            res.status(400).json({ error: 'Folder name is required' });
            return;
        }

        // Verify parent folder exists and belongs to user (if parentId provided)
        if (parentId) {
            const parentFolder = await prisma.folder.findFirst({
                where: { id: parentId, userId },
            });
            if (!parentFolder) {
                res.status(404).json({ error: 'Parent folder not found' });
                return;
            }
        }

        const folder = await prisma.folder.create({
            data: {
                name: name.trim(),
                parentId: parentId || null,
                userId,
            },
        });

        res.status(201).json({ folder });
    } catch (error) {
        console.error('Create folder error:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
};

export const updateFolder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { name } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!name || name.trim() === '') {
            res.status(400).json({ error: 'Folder name is required' });
            return;
        }

        const folder = await prisma.folder.findFirst({
            where: { id, userId },
        });

        if (!folder) {
            res.status(404).json({ error: 'Folder not found' });
            return;
        }

        const updatedFolder = await prisma.folder.update({
            where: { id },
            data: { name: name.trim() },
        });

        res.json({ folder: updatedFolder });
    } catch (error) {
        console.error('Update folder error:', error);
        res.status(500).json({ error: 'Failed to update folder' });
    }
};

export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const folder = await prisma.folder.findFirst({
            where: { id, userId },
        });

        if (!folder) {
            res.status(404).json({ error: 'Folder not found' });
            return;
        }

        // Cascade delete is handled by Prisma schema
        await prisma.folder.delete({
            where: { id },
        });

        res.json({ message: 'Folder deleted successfully' });
    } catch (error) {
        console.error('Delete folder error:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
};

export const getFolderTree = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.userId;

        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        // Get all folders for the user
        const allFolders = await prisma.folder.findMany({
            where: { userId },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                parentId: true,
                _count: {
                    select: { children: true, files: true },
                },
            },
        });

        // Build tree structure
        const buildTree = (parentId: string | null): any[] => {
            return allFolders
                .filter(f => f.parentId === parentId)
                .map(folder => ({
                    id: folder.id,
                    name: folder.name,
                    childCount: folder._count.children,
                    fileCount: folder._count.files,
                    children: buildTree(folder.id),
                }));
        };

        const tree = buildTree(null);

        res.json({ tree });
    } catch (error) {
        console.error('Get folder tree error:', error);
        res.status(500).json({ error: 'Failed to get folder tree' });
    }
};
