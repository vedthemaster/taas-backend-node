import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
    getFiles,
    getFile,
    uploadFile,
    downloadFile,
    deleteFile,
    moveFile
} from '../controllers/fileController';
import {
    initChunkedUpload,
    uploadChunk,
    completeChunkedUpload,
    cancelChunkedUpload,
    downloadChunkedFile
} from '../controllers/chunkedUploadController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Configure multer for standard file uploads (disk storage for small files)
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});

const upload = multer({
    storage: diskStorage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
    },
});

// Chunked upload uses MEMORY storage - no disk writes!
// Chunks are buffered in memory and streamed directly to Telegram
const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB to allow overhead for 19MB chunks
    },
});

// Chunked upload routes (more specific paths first)
router.post('/upload/init', authMiddleware, initChunkedUpload);
router.post('/upload/chunk/:uploadId', authMiddleware, chunkUpload.single('chunk'), uploadChunk);
router.post('/upload/complete/:uploadId', authMiddleware, completeChunkedUpload);
router.delete('/upload/:uploadId', authMiddleware, cancelChunkedUpload);

// Standard file routes - order matters! More specific routes first
router.get('/', authMiddleware, getFiles);
router.post('/upload', authMiddleware, upload.single('file'), uploadFile);

// Streaming download for chunked files (must come before /:id/download)
router.get('/:id/download/stream', authMiddleware, downloadChunkedFile);

// Standard download and other file operations
router.get('/:id/download', authMiddleware, downloadFile);
router.patch('/:id/move', authMiddleware, moveFile);
router.delete('/:id', authMiddleware, deleteFile);

// Get single file (most generic - must be last)
router.get('/:id', authMiddleware, getFile);

export default router;
