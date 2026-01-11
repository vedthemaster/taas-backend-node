import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
/**
 * Initialize a chunked upload
 * POST /api/files/upload/init
 */
export declare const initChunkedUpload: (req: AuthRequest, res: Response) => Promise<void>;
/**
 * Upload a single chunk
 * POST /api/files/upload/chunk/:uploadId
 */
export declare const uploadChunk: (req: AuthRequest, res: Response) => Promise<void>;
/**
 * Complete a chunked upload
 * POST /api/files/upload/complete/:uploadId
 */
export declare const completeChunkedUpload: (req: AuthRequest, res: Response) => Promise<void>;
/**
 * Cancel/abort a chunked upload
 * DELETE /api/files/upload/:uploadId
 */
export declare const cancelChunkedUpload: (req: AuthRequest, res: Response) => Promise<void>;
/**
 * Download a chunked file (streaming via Python service)
 * GET /api/files/:id/download/stream
 */
export declare const downloadChunkedFile: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=chunkedUploadController.d.ts.map