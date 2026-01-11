/**
 * Python Telegram Service Client
 * Communicates with the FastAPI/Telethon service for file operations
 */
interface UploadResult {
    success: boolean;
    message_id: number;
    file_id: string;
}
interface TelegramCredentials {
    botToken: string;
    channelId: string;
    apiId: string;
    apiHash: string;
}
/**
 * Upload a file to Telegram via Python service (using local file path - zero copy)
 * This is much faster than streaming bytes over HTTP when both services are on the same machine
 */
export declare const uploadToTelegram: (credentials: TelegramCredentials, filePath: string, caption: string) => Promise<UploadResult>;
/**
 * Download a single file from Telegram via Python service
 */
export declare const downloadFromTelegram: (credentials: TelegramCredentials, messageId: number) => Promise<Buffer>;
/**
 * Download multiple files (chunks) from Telegram via Python service
 * Returns a stream for piping directly to client (memory-efficient)
 */
export declare const batchDownloadFromTelegramStream: (credentials: TelegramCredentials, messageIds: number[]) => Promise<{
    stream: NodeJS.ReadableStream;
    chunkCount: number;
}>;
/**
 * Legacy: Download all chunks to buffer (high memory usage, use stream version for large files)
 */
export declare const batchDownloadFromTelegram: (credentials: TelegramCredentials, messageIds: number[]) => Promise<Buffer>;
/**
 * Check if Python service is healthy
 */
export declare const checkPythonServiceHealth: () => Promise<boolean>;
interface DeleteResult {
    success: boolean;
    deleted_count: number;
}
/**
 * Delete messages from Telegram via Python service
 */
export declare const deleteFromTelegram: (credentials: TelegramCredentials, messageIds: number[]) => Promise<DeleteResult>;
export {};
//# sourceMappingURL=pythonService.d.ts.map