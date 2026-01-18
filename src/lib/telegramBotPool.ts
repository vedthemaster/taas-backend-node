/**
 * Telegram Bot Pool with Multi-Channel Support
 * Manages multiple bots across multiple channels for maximum throughput
 * Rate limit: 20 messages per minute per bot PER CHANNEL = 3 seconds between messages
 * 
 * With multiple channels, a single bot can send to different channels without hitting limits
 * Example: 4 bots × 3 channels = 240 msg/min (vs 80 msg/min with 1 channel)
 */

// Minimum interval between messages per bot+channel combination (in ms)
const MIN_MESSAGE_INTERVAL_MS = 3000;

interface BotChannelSlot {
    botToken: string;
    channelId: string;
    lastUsedAt: number;
}

export class MultiChannelBotPool {
    private slots: BotChannelSlot[] = [];
    private currentIndex: number = 0;

    /**
     * Create a pool with all bot+channel combinations
     * @param botTokens Array of bot tokens
     * @param channelIds Array of channel IDs (primary + additional)
     */
    constructor(botTokens: string[], channelIds: string[]) {
        // Create a slot for each bot+channel combination
        for (const channelId of channelIds) {
            for (const botToken of botTokens) {
                this.slots.push({
                    botToken,
                    channelId,
                    lastUsedAt: 0,
                });
            }
        }
        console.log(`  📦 Created MultiChannelBotPool: ${botTokens.length} bots × ${channelIds.length} channels = ${this.slots.length} slots`);
    }

    /**
     * Get the next available bot+channel slot using round-robin with rate limiting
     * Returns both the bot token and channel ID to use
     */
    async getAvailableSlot(): Promise<{ botToken: string; channelId: string }> {
        if (this.slots.length === 0) {
            throw new Error('No bot+channel slots configured');
        }

        const now = Date.now();
        const numSlots = this.slots.length;

        // Try each slot starting from current index
        for (let i = 0; i < numSlots; i++) {
            const idx = (this.currentIndex + i) % numSlots;
            const slot = this.slots[idx];
            const timeSinceLast = now - slot.lastUsedAt;

            if (timeSinceLast >= MIN_MESSAGE_INTERVAL_MS) {
                // This slot is available
                slot.lastUsedAt = Date.now();
                this.currentIndex = (idx + 1) % numSlots;
                console.log(`  🤖 Using slot ${idx + 1}/${numSlots} (bot → channel)`);
                return { botToken: slot.botToken, channelId: slot.channelId };
            }
        }

        // All slots on cooldown - find the one that will be available soonest
        let minWait = Infinity;
        let bestIdx = 0;

        for (let i = 0; i < numSlots; i++) {
            const idx = (this.currentIndex + i) % numSlots;
            const slot = this.slots[idx];
            const waitTime = MIN_MESSAGE_INTERVAL_MS - (now - slot.lastUsedAt);
            if (waitTime < minWait) {
                minWait = waitTime;
                bestIdx = idx;
            }
        }

        // Wait for the best slot
        if (minWait > 0) {
            console.log(`  ⏳ All slots on cooldown, waiting ${(minWait / 1000).toFixed(1)}s`);
            await this.sleep(minWait);
        }

        const slot = this.slots[bestIdx];
        slot.lastUsedAt = Date.now();
        this.currentIndex = (bestIdx + 1) % numSlots;
        console.log(`  🤖 Using slot ${bestIdx + 1}/${numSlots} (after wait)`);
        return { botToken: slot.botToken, channelId: slot.channelId };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    get size(): number {
        return this.slots.length;
    }

    get throughputPerMinute(): number {
        // Each slot can send 20 msg/min, rounded down to account for timing
        return this.slots.length * 20;
    }
}

// Legacy single-channel pool for backwards compatibility
interface BotState {
    token: string;
    lastUsedAt: number;
}

export class TelegramBotPool {
    private bots: BotState[] = [];
    private currentIndex: number = 0;

    constructor(tokens: string[]) {
        this.bots = tokens.map(token => ({
            token,
            lastUsedAt: 0,
        }));
    }

    /**
     * Get the next available bot token using round-robin with rate limiting
     */
    async getAvailableBot(): Promise<string> {
        if (this.bots.length === 0) {
            throw new Error('No bots configured');
        }

        const now = Date.now();
        const numBots = this.bots.length;

        // Try each bot starting from current index
        for (let i = 0; i < numBots; i++) {
            const idx = (this.currentIndex + i) % numBots;
            const bot = this.bots[idx];
            const timeSinceLast = now - bot.lastUsedAt;

            if (timeSinceLast >= MIN_MESSAGE_INTERVAL_MS) {
                bot.lastUsedAt = Date.now();
                this.currentIndex = (idx + 1) % numBots;
                console.log(`  🤖 Using bot ${idx + 1}/${numBots}`);
                return bot.token;
            }
        }

        // All bots on cooldown
        let minWait = Infinity;
        let bestIdx = 0;

        for (let i = 0; i < numBots; i++) {
            const idx = (this.currentIndex + i) % numBots;
            const bot = this.bots[idx];
            const waitTime = MIN_MESSAGE_INTERVAL_MS - (now - bot.lastUsedAt);
            if (waitTime < minWait) {
                minWait = waitTime;
                bestIdx = idx;
            }
        }

        if (minWait > 0) {
            console.log(`  ⏳ All bots on cooldown, waiting ${(minWait / 1000).toFixed(1)}s`);
            await this.sleep(minWait);
        }

        const bot = this.bots[bestIdx];
        bot.lastUsedAt = Date.now();
        this.currentIndex = (bestIdx + 1) % numBots;
        console.log(`  🤖 Using bot ${bestIdx + 1}/${numBots} (after wait)`);
        return bot.token;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    get size(): number {
        return this.bots.length;
    }
}

// Cache pools by unique key
const singleChannelPoolCache: Map<string, TelegramBotPool> = new Map();
const multiChannelPoolCache: Map<string, MultiChannelBotPool> = new Map();

/**
 * Get or create a single-channel bot pool (legacy)
 */
export function getBotPool(channelId: string, tokens: string[]): TelegramBotPool {
    const cacheKey = `${channelId}:${tokens.sort().join('|')}`;

    let pool = singleChannelPoolCache.get(cacheKey);
    if (!pool) {
        console.log(`  📦 Creating new BotPool with ${tokens.length} bots`);
        pool = new TelegramBotPool(tokens);
        singleChannelPoolCache.set(cacheKey, pool);
    } else {
        console.log(`  📦 Reusing existing BotPool with ${tokens.length} bots`);
    }

    return pool;
}

/**
 * Get or create a multi-channel bot pool
 * @param botTokens Array of bot tokens
 * @param channelIds Array of channel IDs (primary + additional)
 */
export function getMultiChannelBotPool(botTokens: string[], channelIds: string[]): MultiChannelBotPool {
    const cacheKey = `${botTokens.sort().join('|')}:${channelIds.sort().join('|')}`;

    let pool = multiChannelPoolCache.get(cacheKey);
    if (!pool) {
        pool = new MultiChannelBotPool(botTokens, channelIds);
        multiChannelPoolCache.set(cacheKey, pool);
    } else {
        console.log(`  📦 Reusing existing MultiChannelBotPool with ${pool.size} slots`);
    }

    return pool;
}

/**
 * Clear all cached pools
 */
export function clearBotPoolCache(): void {
    singleChannelPoolCache.clear();
    multiChannelPoolCache.clear();
}
