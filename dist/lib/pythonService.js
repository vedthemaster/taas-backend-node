"use strict";
/**
 * Python Telegram Service Client
 * Communicates with the FastAPI/Telethon service for file operations
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromTelegram = exports.checkPythonServiceHealth = exports.batchDownloadFromTelegram = exports.batchDownloadFromTelegramStream = exports.downloadFromTelegram = exports.uploadToTelegram = void 0;
const axios_1 = __importDefault(require("axios"));
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';
/**
 * Upload a file to Telegram via Python service (using local file path - zero copy)
 * This is much faster than streaming bytes over HTTP when both services are on the same machine
 */
const uploadToTelegram = async (credentials, filePath, caption) => {
    const response = await axios_1.default.post(`${PYTHON_SERVICE_URL}/upload/path`, {
        bot_token: credentials.botToken,
        channel_id: credentials.channelId,
        api_id: credentials.apiId,
        api_hash: credentials.apiHash,
        file_path: filePath,
        caption: caption,
        delete_after: true, // Python service will delete the temp file after upload
    });
    return response.data;
};
exports.uploadToTelegram = uploadToTelegram;
/**
 * Download a single file from Telegram via Python service
 */
const downloadFromTelegram = async (credentials, messageId) => {
    const response = await axios_1.default.post(`${PYTHON_SERVICE_URL}/download`, {
        bot_token: credentials.botToken,
        channel_id: credentials.channelId,
        api_id: credentials.apiId,
        api_hash: credentials.apiHash,
        message_id: messageId,
    }, {
        responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
};
exports.downloadFromTelegram = downloadFromTelegram;
/**
 * Download multiple files (chunks) from Telegram via Python service
 * Returns a stream for piping directly to client (memory-efficient)
 */
const batchDownloadFromTelegramStream = async (credentials, messageIds) => {
    const response = await axios_1.default.post(`${PYTHON_SERVICE_URL}/download/batch`, {
        bot_token: credentials.botToken,
        channel_id: credentials.channelId,
        api_id: credentials.apiId,
        api_hash: credentials.apiHash,
        message_ids: messageIds,
    }, {
        responseType: 'stream',
    });
    return {
        stream: response.data,
        chunkCount: parseInt(response.headers['x-chunk-count'] || '0'),
    };
};
exports.batchDownloadFromTelegramStream = batchDownloadFromTelegramStream;
/**
 * Legacy: Download all chunks to buffer (high memory usage, use stream version for large files)
 */
const batchDownloadFromTelegram = async (credentials, messageIds) => {
    const response = await axios_1.default.post(`${PYTHON_SERVICE_URL}/download/batch`, {
        bot_token: credentials.botToken,
        channel_id: credentials.channelId,
        api_id: credentials.apiId,
        api_hash: credentials.apiHash,
        message_ids: messageIds,
    }, {
        responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
};
exports.batchDownloadFromTelegram = batchDownloadFromTelegram;
/**
 * Check if Python service is healthy
 */
const checkPythonServiceHealth = async () => {
    try {
        const response = await axios_1.default.get(`${PYTHON_SERVICE_URL}/health`, { timeout: 2000 });
        return response.data.status === 'healthy';
    }
    catch {
        return false;
    }
};
exports.checkPythonServiceHealth = checkPythonServiceHealth;
/**
 * Delete messages from Telegram via Python service
 */
const deleteFromTelegram = async (credentials, messageIds) => {
    const response = await axios_1.default.post(`${PYTHON_SERVICE_URL}/delete`, {
        bot_token: credentials.botToken,
        channel_id: credentials.channelId,
        api_id: credentials.apiId,
        api_hash: credentials.apiHash,
        message_ids: messageIds,
    });
    return response.data;
};
exports.deleteFromTelegram = deleteFromTelegram;
//# sourceMappingURL=pythonService.js.map