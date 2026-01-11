import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
export declare const getFolders: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getFolder: (req: AuthRequest, res: Response) => Promise<void>;
export declare const createFolder: (req: AuthRequest, res: Response) => Promise<void>;
export declare const updateFolder: (req: AuthRequest, res: Response) => Promise<void>;
export declare const deleteFolder: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getFolderTree: (req: AuthRequest, res: Response) => Promise<void>;
//# sourceMappingURL=folderController.d.ts.map