/**
 * Communication channel for AI chat requests
 * Determines streaming granularity:
 * - 'web': Fine-grained character-by-character streaming
 */
export type ChannelType = 'web';

/**
 * Default channel when not specified (web for backward compatibility)
 */
export const DEFAULT_CHANNEL: ChannelType = 'web';

