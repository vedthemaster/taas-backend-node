import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { TelegramClient } from 'telegram';
declare const telegramClients: Map<string, TelegramClient>;
export declare const setupTelegram: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getTelegramStatus: (req: AuthRequest, res: Response) => Promise<void>;
export declare const validateTelegram: (req: AuthRequest, res: Response) => Promise<void>;
export declare const getTelegramClient: (userId: string) => Promise<TelegramClient | null>;
export { telegramClients };
//# sourceMappingURL=telegramController.d.ts.map