/**
 * Python Telegram Service Client
 * Communicates with the FastAPI/Telethon service for file operations
 */

import axios from 'axios';

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

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
export const uploadToTelegram = async (
    credentials: TelegramCredentials,
    filePath: string,
    caption: string
): Promise<UploadResult> => {
    const response = await axios.post<UploadResult>(
        `${PYTHON_SERVICE_URL}/upload/path`,
        {
            bot_token: credentials.botToken,
            channel_id: credentials.channelId,
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            file_path: filePath,
            caption: caption,
            delete_after: true,  // Python service will delete the temp file after upload
        }
    );

    return response.data;
};

/**
 * Download a single file from Telegram via Python service
 */
export const downloadFromTelegram = async (
    credentials: TelegramCredentials,
    messageId: number
): Promise<Buffer> => {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/download`,
        {
            bot_token: credentials.botToken,
            channel_id: credentials.channelId,
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            message_id: messageId,
        },
        {
            responseType: 'arraybuffer',
        }
    );

    return Buffer.from(response.data);
};

/**
 * Download multiple files (chunks) from Telegram via Python service
 * Returns a stream for piping directly to client (memory-efficient)
 */
export const batchDownloadFromTelegramStream = async (
    credentials: TelegramCredentials,
    messageIds: number[]
): Promise<{ stream: NodeJS.ReadableStream; chunkCount: number }> => {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/download/batch`,
        {
            bot_token: credentials.botToken,
            channel_id: credentials.channelId,
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            message_ids: messageIds,
        },
        {
            responseType: 'stream',
        }
    );

    return {
        stream: response.data,
        chunkCount: parseInt(response.headers['x-chunk-count'] || '0'),
    };
};

/**
 * Legacy: Download all chunks to buffer (high memory usage, use stream version for large files)
 */
export const batchDownloadFromTelegram = async (
    credentials: TelegramCredentials,
    messageIds: number[]
): Promise<Buffer> => {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/download/batch`,
        {
            bot_token: credentials.botToken,
            channel_id: credentials.channelId,
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            message_ids: messageIds,
        },
        {
            responseType: 'arraybuffer',
        }
    );

    return Buffer.from(response.data);
};

/**
 * Check if Python service is healthy
 */
export const checkPythonServiceHealth = async (): Promise<boolean> => {
    try {
        const response = await axios.get(`${PYTHON_SERVICE_URL}/health`, { timeout: 2000 });
        return response.data.status === 'healthy';
    } catch {
        return false;
    }
};

interface DeleteResult {
    success: boolean;
    deleted_count: number;
}

/**
 * Delete messages from Telegram via Python service
 */
export const deleteFromTelegram = async (
    credentials: TelegramCredentials,
    messageIds: number[]
): Promise<DeleteResult> => {
    const response = await axios.post<DeleteResult>(
        `${PYTHON_SERVICE_URL}/delete`,
        {
            bot_token: credentials.botToken,
            channel_id: credentials.channelId,
            api_id: credentials.apiId,
            api_hash: credentials.apiHash,
            message_ids: messageIds,
        }
    );

    return response.data;
};
