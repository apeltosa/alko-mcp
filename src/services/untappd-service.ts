import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.js';
import { RateLimiter, ExponentialBackoff } from '../utils/rate-limiter.js';
import type { UntappdRating, UntappdRatingResult } from '../types/untappd.js';

const DEFAULT_ALGOLIA_APP_ID = '9WBO4RQ3HO';
const DEFAULT_ALGOLIA_API_KEY = '1d347324d67ec472bb7132c66aead485';
const REQUEST_TIMEOUT_MS = 6000;

export class UntappdService {
  private memoryCache: LRUCache<string, UntappdRatingResult>;
  private rateLimiter: RateLimiter;
  private backoff: ExponentialBackoff;

  constructor() {
    this.rateLimiter = new RateLimiter(1000);
    this.backoff = new ExponentialBackoff();
    this.memoryCache = new LRUCache<string, UntappdRatingResult>({
      max: 500,
      ttl: 60 * 60 * 1000, // 1 hour
    });
  }

  async getBeerRating(beerName?: string, brewery?: string): Promise<UntappdRatingResult> {
    const cleanName = (beerName || '').trim();
    const cleanBrewery = (brewery || '').trim();
    const query = cleanBrewery ? `${cleanBrewery} ${cleanName}` : cleanName;

    if (!query) {
      return {
        found: false,
        rating: null,
        error: 'Either beerName or query must be provided',
        fromCache: false,
      };
    }

    const cacheKey = query.toLowerCase();
    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      logger.debug(`Memory cache hit for Untappd: ${cacheKey}`);
      return { ...cached, fromCache: true };
    }

    await this.rateLimiter.throttleWithJitter();
    logger.info(`Searching Untappd for: ${query}`);

    const appId = process.env.UNTAPPD_ALGOLIA_APP_ID || DEFAULT_ALGOLIA_APP_ID;
    const apiKey = process.env.UNTAPPD_ALGOLIA_API_KEY || DEFAULT_ALGOLIA_API_KEY;
    const endpoint = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/beer/query?x-algolia-application-id=${encodeURIComponent(appId)}&x-algolia-api-key=${encodeURIComponent(apiKey)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          params: `query=${encodeURIComponent(query)}&hitsPerPage=4`,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`[Untappd Search Error] Status ${response.status}: ${errText}`);
        return {
          found: false,
          rating: null,
          error: `Untappd search failed (HTTP ${response.status})`,
          fromCache: false,
        };
      }

      const data: any = await response.json();
      const hits: any[] = Array.isArray(data.hits) ? data.hits : [];

      if (hits.length === 0) {
        const notFound: UntappdRatingResult = {
          found: false,
          rating: null,
          error: `Untappdista ei löytynyt olutta haulla "${query}".`,
          fromCache: false,
        };
        this.memoryCache.set(cacheKey, notFound);
        return notFound;
      }

      const top = hits[0];
      const bid = Number(top.bid || top.objectID);
      const slug = top.beer_slug || '';
      const url = slug ? `https://untappd.com/b/${slug}/${bid}` : `https://untappd.com/beer/${bid}`;

      const ratingObj: UntappdRating = {
        beerName: top.beer_name || cleanName,
        brewery: top.brewery_name || null,
        averageRating: typeof top.rating_score === 'number' && top.rating_score > 0 ? Number(top.rating_score.toFixed(2)) : 0,
        ratingsCount: typeof top.rating_count === 'number' ? top.rating_count : 0,
        untappdUrl: url,
        style: top.type_name || null,
        abv: typeof top.beer_abv === 'number' ? top.beer_abv : null,
        fetchedAt: new Date(),
      };

      const alternativeMatches = hits.slice(1).map((h) => {
        const hBid = Number(h.bid || h.objectID);
        const hSlug = h.beer_slug || '';
        const hUrl = hSlug ? `https://untappd.com/b/${hSlug}/${hBid}` : `https://untappd.com/beer/${hBid}`;
        return {
          beerName: h.beer_name || '',
          brewery: h.brewery_name || null,
          rating: typeof h.rating_score === 'number' && h.rating_score > 0 ? Number(h.rating_score.toFixed(2)) : null,
          ratingsCount: typeof h.rating_count === 'number' ? h.rating_count : 0,
          untappdUrl: hUrl,
          abv: typeof h.beer_abv === 'number' ? h.beer_abv : null,
        };
      });

      const result: UntappdRatingResult = {
        found: true,
        rating: ratingObj,
        alternativeMatches: alternativeMatches.length > 0 ? alternativeMatches : undefined,
        error: null,
        fromCache: false,
      };

      this.memoryCache.set(cacheKey, result);
      logger.info(`Got Untappd rating: ${ratingObj.averageRating}/5.0 (${ratingObj.ratingsCount} reviews) for ${ratingObj.beerName}`);
      return result;
    } catch (error) {
      logger.error('Failed to get Untappd rating', { error });
      await this.backoff.wait();
      return {
        found: false,
        rating: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        fromCache: false,
      };
    }
  }
}

let untappdServiceInstance: UntappdService | null = null;

export function getUntappdService(): UntappdService {
  if (!untappdServiceInstance) {
    untappdServiceInstance = new UntappdService();
  }
  return untappdServiceInstance;
}
