/**
 * Telegram Bot API Client
 * Direct HTTP API calls for lightweight operations (delete, etc.)
 * Avoids MTProto overhead for simple operations
 */
interface DeleteResult {
    ok: boolean;
    message_id?: number;
    error?: string;
}
/**
 * Delete a single message from Telegram
 */
export declare const deleteMessage: (botToken: string, chatId: string, messageId: number) => Promise<DeleteResult>;
/**
 * Delete multiple messages with rate limiting
 * Handles chunked files by deleting all chunk messages
 */
export declare const deleteMessages: (botToken: string, chatId: string, messageIds: number[]) => Promise<{
    success: number;
    failed: number;
    errors: string[];
}>;
/**
 * Delete file from Telegram (handles both single files and chunked files)
 * Respects ENABLE_TELEGRAM_DELETE flag - when false, returns success without making API calls
 */
export declare const deleteFileFromTelegram: (botToken: string, channelId: string, messageIds: number | number[]) => Promise<{
    success: boolean;
    deleted: number;
    failed: number;
}>;
export {};
//# sourceMappingURL=telegramBotApi.d.ts.map