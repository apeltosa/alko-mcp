import { z } from 'zod';
import { getWhiskybaseScraper } from '../services/whiskybase-scraper.js';
import { logger } from '../utils/logger.js';
import type { WhiskybaseRatingResult } from '../types/whiskybase.js';

export const getWhiskybaseRatingSchema = z
  .object({
    whiskyName: z
      .string()
      .optional()
      .describe('The whisky name to search for on Whiskybase (e.g. "Lagavulin 16", "Ardbeg Uigeadail", "Macallan 12")'),
    distillery: z
      .string()
      .optional()
      .describe('Distillery or producer name to help narrow down the search'),
    query: z
      .string()
      .optional()
      .describe('Search query alias for whiskyName'),
    whiskyUrl: z
      .string()
      .optional()
      .describe('Direct Whiskybase URL if known (e.g. "https://www.whiskybase.com/whiskies/whisky/51469")'),
  })
  .refine((data) => data.whiskyName || data.query || data.whiskyUrl, {
    message: 'Either whiskyName, query, or whiskyUrl must be provided',
  });

export type GetWhiskybaseRatingInput = z.infer<typeof getWhiskybaseRatingSchema>;

export async function getWhiskybaseRating(input: GetWhiskybaseRatingInput): Promise<WhiskybaseRatingResult> {
  const targetName = input.whiskyName || input.query;
  logger.info('Getting Whiskybase rating', { whiskyName: targetName, distillery: input.distillery, whiskyUrl: input.whiskyUrl });

  const scraper = getWhiskybaseScraper();

  try {
    return await scraper.getWhiskyRating(targetName, input.distillery, input.whiskyUrl);
  } catch (error) {
    logger.error('Failed to get Whiskybase rating', { error });
    return {
      found: false,
      rating: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      fromCache: false,
    };
  }
}
