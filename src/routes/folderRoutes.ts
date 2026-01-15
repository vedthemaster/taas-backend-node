import { Router } from 'express';
import {
    getFolders,
    getFolder,
    createFolder,
    updateFolder,
    deleteFolder,
    getFolderTree,
    moveFolder
} from '../controllers/folderController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware, getFolders);
router.get('/tree', authMiddleware, getFolderTree);
router.get('/:id', authMiddleware, getFolder);
router.post('/', authMiddleware, createFolder);
router.put('/:id', authMiddleware, updateFolder);
router.patch('/:id/move', authMiddleware, moveFolder);
router.delete('/:id', authMiddleware, deleteFolder);

export default router;
