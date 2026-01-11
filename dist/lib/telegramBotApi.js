"use strict";
/**
 * Telegram Bot API Client
 * Direct HTTP API calls for lightweight operations (delete, etc.)
 * Avoids MTProto overhead for simple operations
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFileFromTelegram = exports.deleteMessages = exports.deleteMessage = void 0;
const axios_1 = __importDefault(require("axios"));
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
// Rate limiting: Max 20 deletes per minute per channel to be safe
const DELETE_DELAY_MS = 100; // 100ms between deletes (10/second, well under limit)
/**
 * Toggle to enable/disable deleting files from Telegram
 * Set to true to delete from both Telegram and database
 * Set to false to only delete from database (faster, Telegram storage is unlimited anyway)
 */
const ENABLE_TELEGRAM_DELETE = false;
/**
 * Delete a single message from Telegram
 */
const deleteMessage = async (botToken, chatId, messageId) => {
    try {
        const response = await axios_1.default.post(`${TELEGRAM_API_BASE}${botToken}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId,
        });
        return {
            ok: response.data.result === true,
            message_id: messageId,
        };
    }
    catch (error) {
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
exports.deleteMessage = deleteMessage;
/**
 * Sleep helper for rate limiting
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Delete multiple messages with rate limiting
 * Handles chunked files by deleting all chunk messages
 */
const deleteMessages = async (botToken, chatId, messageIds) => {
    let success = 0;
    let failed = 0;
    const errors = [];
    for (let i = 0; i < messageIds.length; i++) {
        const messageId = messageIds[i];
        const result = await (0, exports.deleteMessage)(botToken, chatId, messageId);
        if (result.ok) {
            success++;
        }
        else {
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
exports.deleteMessages = deleteMessages;
/**
 * Delete file from Telegram (handles both single files and chunked files)
 * Respects ENABLE_TELEGRAM_DELETE flag - when false, returns success without making API calls
 */
const deleteFileFromTelegram = async (botToken, channelId, messageIds) => {
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
    const result = await (0, exports.deleteMessages)(botToken, channelId, validIds);
    return {
        success: result.failed === 0,
        deleted: result.success,
        failed: result.failed,
    };
};
exports.deleteFileFromTelegram = deleteFileFromTelegram;
//# sourceMappingURL=telegramBotApi.js.map