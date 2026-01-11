import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
    getFiles,
    getFile,
    uploadFile,
    downloadFile,
    deleteFile
} from '../controllers/fileController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Configure multer for file uploads
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit (Telegram MTProto limit)
    },
});

router.get('/', authMiddleware, getFiles);
router.get('/:id', authMiddleware, getFile);
router.post('/upload', authMiddleware, upload.single('file'), uploadFile);
router.get('/:id/download', authMiddleware, downloadFile);
router.delete('/:id', authMiddleware, deleteFile);

export default router;
