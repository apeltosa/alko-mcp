import { z } from 'zod';
import { getUntappdService } from '../services/untappd-service.js';
import { logger } from '../utils/logger.js';
import type { UntappdRatingResult } from '../types/untappd.js';

export const getUntappdRatingSchema = z
  .object({
    beerName: z
      .string()
      .optional()
      .describe('The beer or cider name to search for on Untappd (e.g. "Fat Lizard Ankle Slapper", "Sandels")'),
    brewery: z
      .string()
      .optional()
      .describe('Brewery name to help narrow down the search'),
    query: z
      .string()
      .optional()
      .describe('Search query alias for beerName'),
  })
  .refine((data) => data.beerName || data.query, {
    message: 'Either beerName or query must be provided',
  });

export type GetUntappdRatingInput = z.infer<typeof getUntappdRatingSchema>;

export async function getUntappdRating(input: GetUntappdRatingInput): Promise<UntappdRatingResult> {
  const targetName = input.beerName || input.query;
  logger.info('Getting Untappd rating', { beerName: targetName, brewery: input.brewery });

  const service = getUntappdService();

  try {
    return await service.getBeerRating(targetName, input.brewery);
  } catch (error) {
    logger.error('Failed to get Untappd rating', { error });
    return {
      found: false,
      rating: null,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      fromCache: false,
    };
  }
}
