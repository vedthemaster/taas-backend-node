/**
 * Telegram Bot API Client
 * Direct HTTP API calls for lightweight operations (delete, etc.)
 * Avoids MTProto overhead for simple operations
 */

import axios from 'axios';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// Rate limiting: Max 20 deletes per minute per channel to be safe
const DELETE_DELAY_MS = 100; // 100ms between deletes (10/second, well under limit)

/**
 * Toggle to enable/disable deleting files from Telegram
 * Set to true to delete from both Telegram and database
 * Set to false to only delete from database (faster, Telegram storage is unlimited anyway)
 */
const ENABLE_TELEGRAM_DELETE = false;

interface DeleteResult {
    ok: boolean;
    message_id?: number;
    error?: string;
}

/**
 * Delete a single message from Telegram
 */
export const deleteMessage = async (
    botToken: string,
    chatId: string,
    messageId: number
): Promise<DeleteResult> => {
    try {
        const response = await axios.post(
            `${TELEGRAM_API_BASE}${botToken}/deleteMessage`,
            {
                chat_id: chatId,
                message_id: messageId,
            }
        );

        return {
            ok: response.data.result === true,
            message_id: messageId,
        };
    } catch (error: any) {
        // Handle specific Telegram errors gracefully
        const errorMsg = error.response?.data?.description || error.message;
        console.warn(`Failed to delete message ${messageId}:`, errorMsg);

        return {
            ok: false,
            message_id: messageId,
            error: errorMsg,
        };
    }
};

/**
 * Sleep helper for rate limiting
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Delete multiple messages with rate limiting
 * Handles chunked files by deleting all chunk messages
 */
export const deleteMessages = async (
    botToken: string,
    chatId: string,
    messageIds: number[]
): Promise<{ success: number; failed: number; errors: string[] }> => {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < messageIds.length; i++) {
        const messageId = messageIds[i];

        const result = await deleteMessage(botToken, chatId, messageId);

        if (result.ok) {
            success++;
        } else {
            failed++;
            if (result.error) {
                errors.push(`Message ${messageId}: ${result.error}`);
            }
        }

        // Rate limiting: Add delay between requests (skip after last one)
        if (i < messageIds.length - 1) {
            await sleep(DELETE_DELAY_MS);
        }
    }

    return { success, failed, errors };
};

/**
 * Delete file from Telegram (handles both single files and chunked files)
 * Respects ENABLE_TELEGRAM_DELETE flag - when false, returns success without making API calls
 */
export const deleteFileFromTelegram = async (
    botToken: string,
    channelId: string,
    messageIds: number | number[]
): Promise<{ success: boolean; deleted: number; failed: number }> => {
    // Skip Telegram deletion if disabled (database-only delete)
    if (!ENABLE_TELEGRAM_DELETE) {
        return { success: true, deleted: 0, failed: 0 };
    }

    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];

    // Filter out null/undefined message IDs
    const validIds = ids.filter(id => id != null && id > 0);

    if (validIds.length === 0) {
        return { success: true, deleted: 0, failed: 0 };
    }

    const result = await deleteMessages(botToken, channelId, validIds);

    return {
        success: result.failed === 0,
        deleted: result.success,
        failed: result.failed,
    };
};
