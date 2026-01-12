/**
 * Python Telegram Service Client (aiogram)
 * Communicates with the FastAPI/aiogram service for file operations
 * Multi-bot support with rate limiting
 */

import axios from 'axios';

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

interface UploadResult {
    message_id: number;
    file_id: string;
}

interface MultiBot {
    channelId: string;
    botTokens: string[];
}

/**
 * Upload a file to Telegram via Python service (using local file path - zero copy)
 */
export const uploadToTelegram = async (
    config: MultiBot,
    filePath: string,
    caption: string
): Promise<UploadResult> => {
    const response = await axios.post<UploadResult>(
        `${PYTHON_SERVICE_URL}/upload/path`,
        {
            channel_id: config.channelId,
            bot_tokens: config.botTokens,
            file_path: filePath,
            caption: caption,
            delete_after: true,
        }
    );

    return response.data;
};

/**
 * Download files by file_ids from Telegram via Python service
 * Returns a stream for piping directly to client (memory-efficient)
 */
export const downloadByFileIdsStream = async (
    config: MultiBot,
    fileIds: string[]
): Promise<{ stream: NodeJS.ReadableStream; fileCount: number }> => {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/download/by-file-ids`,
        {
            bot_tokens: config.botTokens,
            file_ids: fileIds,
        },
        {
            responseType: 'stream',
        }
    );

    return {
        stream: response.data,
        fileCount: parseInt(response.headers['x-file-count'] || '0'),
    };
};

/**
 * Download files by file_ids to buffer (for smaller files)
 */
export const downloadByFileIds = async (
    config: MultiBot,
    fileIds: string[]
): Promise<Buffer> => {
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/download/by-file-ids`,
        {
            bot_tokens: config.botTokens,
            file_ids: fileIds,
        },
        {
            responseType: 'arraybuffer',
        }
    );

    return Buffer.from(response.data);
};

/**
 * Verify a bot token
 */
export const verifyBotToken = async (
    botToken: string
): Promise<{ valid: boolean; username?: string; error?: string }> => {
    const response = await axios.post(`${PYTHON_SERVICE_URL}/verify-bot`, {
        bot_token: botToken,
    });
    return response.data;
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
