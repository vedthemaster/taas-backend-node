/**
 * Telegram Stream API
 * Direct HTTP API calls to Telegram Bot API for upload/download
 * No Python service dependency
 */

import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// Timeout for large file uploads (5 minutes)
const UPLOAD_TIMEOUT_MS = 300000;
// Timeout for downloads (3 minutes)
const DOWNLOAD_TIMEOUT_MS = 180000;
// Max retries for failed uploads
const MAX_RETRIES = 3;
// Delay between retries (exponential backoff)
const RETRY_BASE_DELAY_MS = 1000;

interface UploadResult {
    messageId: number;
    fileId: string;
}

/**
 * Upload a buffer to Telegram channel as a document
 * Retries up to MAX_RETRIES times on failure
 */
export async function uploadChunkToTelegram(
    buffer: Buffer,
    channelId: string,
    botToken: string,
    filename: string,
    caption?: string
): Promise<UploadResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await uploadOnce(buffer, channelId, botToken, filename, caption);
            return result;
        } catch (error: any) {
            lastError = error;
            console.error(`  ❌ Upload attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

            if (attempt < MAX_RETRIES) {
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`  🔄 Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error('Upload failed after max retries');
}

/**
 * Single upload attempt
 */
async function uploadOnce(
    buffer: Buffer,
    channelId: string,
    botToken: string,
    filename: string,
    caption?: string
): Promise<UploadResult> {
    const form = new FormData();
    form.append('chat_id', channelId);
    form.append('document', buffer, { filename });
    if (caption) {
        form.append('caption', caption);
    }

    const url = `${TELEGRAM_API_BASE}${botToken}/sendDocument`;

    const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: UPLOAD_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });

    if (!response.data.ok) {
        throw new Error(`Telegram API error: ${response.data.description}`);
    }

    const message = response.data.result;
    return {
        messageId: message.message_id,
        fileId: message.document?.file_id || '',
    };
}

/**
 * Get file info from Telegram by file_id
 */
async function getFileInfo(fileId: string, botToken: string): Promise<{ filePath: string }> {
    const url = `${TELEGRAM_API_BASE}${botToken}/getFile`;

    const response = await axios.post(url, { file_id: fileId }, {
        timeout: 30000,
    });

    if (!response.data.ok) {
        throw new Error(`Telegram API error: ${response.data.description}`);
    }

    return {
        filePath: response.data.result.file_path,
    };
}

/**
 * Download a file from Telegram and return as a readable stream
 */
export async function downloadFileFromTelegram(
    fileId: string,
    botToken: string
): Promise<{ stream: Readable; size: number }> {
    // First get the file path
    const { filePath } = await getFileInfo(fileId, botToken);

    // Download the file
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
    });

    const size = parseInt(response.headers['content-length'] || '0', 10);

    return {
        stream: response.data,
        size,
    };
}

/**
 * Download multiple files (chunks) and yield them in order
 */
export async function* downloadChunksFromTelegram(
    fileIds: string[],
    botToken: string
): AsyncGenerator<Buffer> {
    for (let i = 0; i < fileIds.length; i++) {
        console.log(`  📦 Downloading chunk ${i + 1}/${fileIds.length}`);

        const { stream } = await downloadFileFromTelegram(fileIds[i], botToken);

        // Collect stream into buffer
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }

        yield Buffer.concat(chunks);
    }
}

/**
 * Delete a message from Telegram channel
 */
export async function deleteMessageFromTelegram(
    channelId: string,
    messageId: number,
    botToken: string
): Promise<boolean> {
    try {
        const url = `${TELEGRAM_API_BASE}${botToken}/deleteMessage`;

        const response = await axios.post(url, {
            chat_id: channelId,
            message_id: messageId,
        }, {
            timeout: 30000,
        });

        return response.data.ok === true;
    } catch (error) {
        console.error('Failed to delete message:', error);
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
