import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
export declare const getFiles: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getFile: (req: AuthRequest, res: Response) => Promise<void>;
export declare const uploadFile: (req: AuthRequest, res: Response) => Promise<void>;
export declare const downloadFile: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteFile: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=fileController.d.ts.map