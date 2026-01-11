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
import {
    initChunkedUpload,
    uploadChunk,
    completeChunkedUpload,
    cancelChunkedUpload,
    downloadChunkedFile
} from '../controllers/chunkedUploadController';
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

// Chunked upload for large files (32MB chunks)
const chunkUpload = multer({
    storage,
    limits: {
        fileSize: 40 * 1024 * 1024, // 40MB to allow overhead for 32MB chunks
    },
});

// Standard file routes
router.get('/', authMiddleware, getFiles);
router.get('/:id', authMiddleware, getFile);
router.post('/upload', authMiddleware, upload.single('file'), uploadFile);
router.get('/:id/download', authMiddleware, downloadFile);
router.delete('/:id', authMiddleware, deleteFile);

// Chunked upload routes
router.post('/upload/init', authMiddleware, initChunkedUpload);
router.post('/upload/chunk/:uploadId', authMiddleware, chunkUpload.single('chunk'), uploadChunk);
router.post('/upload/complete/:uploadId', authMiddleware, completeChunkedUpload);
router.delete('/upload/:uploadId', authMiddleware, cancelChunkedUpload);

// Streaming download for chunked files
router.get('/:id/download/stream', authMiddleware, downloadChunkedFile);

export default router;
