"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const fileController_1 = require("../controllers/fileController");
const chunkedUploadController_1 = require("../controllers/chunkedUploadController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Configure multer for file uploads
const tempDir = path_1.default.join(process.cwd(), 'temp');
if (!fs_1.default.existsSync(tempDir)) {
    fs_1.default.mkdirSync(tempDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit (Telegram MTProto limit)
    },
});
// Chunked upload for large files (16MB chunks)
const chunkUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB to allow some overhead
    },
});
// Standard file routes
router.get('/', authMiddleware_1.authMiddleware, fileController_1.getFiles);
router.get('/:id', authMiddleware_1.authMiddleware, fileController_1.getFile);
router.post('/upload', authMiddleware_1.authMiddleware, upload.single('file'), fileController_1.uploadFile);
router.get('/:id/download', authMiddleware_1.authMiddleware, fileController_1.downloadFile);
router.delete('/:id', authMiddleware_1.authMiddleware, fileController_1.deleteFile);
// Chunked upload routes
router.post('/upload/init', authMiddleware_1.authMiddleware, chunkedUploadController_1.initChunkedUpload);
router.post('/upload/chunk/:uploadId', authMiddleware_1.authMiddleware, chunkUpload.single('chunk'), chunkedUploadController_1.uploadChunk);
router.post('/upload/complete/:uploadId', authMiddleware_1.authMiddleware, chunkedUploadController_1.completeChunkedUpload);
router.delete('/upload/:uploadId', authMiddleware_1.authMiddleware, chunkedUploadController_1.cancelChunkedUpload);
// Streaming download for chunked files
router.get('/:id/download/stream', authMiddleware_1.authMiddleware, chunkedUploadController_1.downloadChunkedFile);
exports.default = router;
//# sourceMappingURL=fileRoutes.js.map