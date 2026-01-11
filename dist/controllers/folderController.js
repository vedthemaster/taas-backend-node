"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFolderTree = exports.deleteFolder = exports.updateFolder = exports.createFolder = exports.getFolder = exports.getFolders = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
// Helper to convert BigInt to string for JSON serialization
const serializeBigInt = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) => typeof value === 'bigint' ? value.toString() : value));
};
const getFolders = async (req, res) => {
    try {
        const userId = req.userId;
        const { parentId } = req.query;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const folders = await prisma_1.default.folder.findMany({
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
    }
    catch (error) {
        console.error('Get folders error:', error);
        res.status(500).json({ error: 'Failed to get folders' });
    }
};
exports.getFolders = getFolders;
const getFolder = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const folder = await prisma_1.default.folder.findFirst({
            where: {
                id: String(id),
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
            const parent = await prisma_1.default.folder.findUnique({
                where: { id: current.parent.id },
                include: { parent: { select: { id: true, name: true, parentId: true } } },
            });
            if (parent) {
                breadcrumbs.unshift({ id: parent.id, name: parent.name });
                current = parent;
            }
            else {
                break;
            }
        }
        res.json(serializeBigInt({ folder, breadcrumbs }));
    }
    catch (error) {
        console.error('Get folder error:', error);
        res.status(500).json({ error: 'Failed to get folder' });
    }
};
exports.getFolder = getFolder;
const createFolder = async (req, res) => {
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
            const parentFolder = await prisma_1.default.folder.findFirst({
                where: { id: parentId, userId },
            });
            if (!parentFolder) {
                res.status(404).json({ error: 'Parent folder not found' });
                return;
            }
        }
        const folder = await prisma_1.default.folder.create({
            data: {
                name: name.trim(),
                parentId: parentId || null,
                userId,
            },
        });
        res.status(201).json({ folder });
    }
    catch (error) {
        console.error('Create folder error:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
};
exports.createFolder = createFolder;
const updateFolder = async (req, res) => {
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
        const folder = await prisma_1.default.folder.findFirst({
            where: { id: String(id), userId },
        });
        if (!folder) {
            res.status(404).json({ error: 'Folder not found' });
            return;
        }
        const updatedFolder = await prisma_1.default.folder.update({
            where: { id: String(id) },
            data: { name: name.trim() },
        });
        res.json({ folder: updatedFolder });
    }
    catch (error) {
        console.error('Update folder error:', error);
        res.status(500).json({ error: 'Failed to update folder' });
    }
};
exports.updateFolder = updateFolder;
const deleteFolder = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        const folder = await prisma_1.default.folder.findFirst({
            where: { id: String(id), userId },
        });
        if (!folder) {
            res.status(404).json({ error: 'Folder not found' });
            return;
        }
        // Cascade delete is handled by Prisma schema
        await prisma_1.default.folder.delete({
            where: { id: String(id) },
        });
        res.json({ message: 'Folder deleted successfully' });
    }
    catch (error) {
        console.error('Delete folder error:', error);
        res.status(500).json({ error: 'Failed to delete folder' });
    }
};
exports.deleteFolder = deleteFolder;
const getFolderTree = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        // Get all folders for the user
        const allFolders = await prisma_1.default.folder.findMany({
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
        const buildTree = (parentId) => {
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
    }
    catch (error) {
        console.error('Get folder tree error:', error);
        res.status(500).json({ error: 'Failed to get folder tree' });
    }
};
exports.getFolderTree = getFolderTree;
//# sourceMappingURL=folderController.js.map