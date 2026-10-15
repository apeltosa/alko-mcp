import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.js';
import { RateLimiter, ExponentialBackoff } from '../utils/rate-limiter.js';
import type { WhiskybaseRating, WhiskybaseRatingResult } from '../types/whiskybase.js';

/**
 * Whiskybase website scraper for whisky ratings
 * Uses Playwright to fetch rating data from Whiskybase.com
 * Caches results in-memory L1 cache (1 hour)
 */
export class WhiskybaseScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private rateLimiter: RateLimiter;
  private backoff: ExponentialBackoff;
  private memoryCache: LRUCache<string, WhiskybaseRatingResult>;

  constructor() {
    this.rateLimiter = new RateLimiter(2000);
    this.backoff = new ExponentialBackoff();
    this.memoryCache = new LRUCache<string, WhiskybaseRatingResult>({
      max: 500,
      ttl: 60 * 60 * 1000, // 1 hour
    });
  }

  /**
   * Initialize the browser with stealth options
   */
  async init(): Promise<void> {
    if (this.browser) {
      return;
    }

    logger.info('Initializing Playwright browser for Whiskybase');

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });

    this.page = await this.context.newPage();

    // Inject stealth script
    await this.page.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      window.chrome = { runtime: {} };
    `);

    logger.info('Whiskybase browser initialized');
  }

  /**
   * Search for a whisky on Whiskybase by name or fetch from direct URL
   */
  async getWhiskyRating(whiskyName?: string, distillery?: string, directUrl?: string): Promise<WhiskybaseRatingResult> {
    const rawQuery = directUrl || `${whiskyName || ''} ${distillery || ''}`.trim();
    const cacheKey = rawQuery.toLowerCase();

    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      logger.debug(`Memory cache hit for Whiskybase: ${cacheKey}`);
      return { ...cached, fromCache: true };
    }

    if (!this.browser) {
      await this.init();
    }

    await this.rateLimiter.throttleWithJitter();

    try {
      let targetUrl = directUrl;

      if (!targetUrl) {
        const searchQuery = distillery ? `${distillery} ${whiskyName}` : (whiskyName || '');
        const searchUrl = `https://www.whiskybase.com/search?q=${encodeURIComponent(searchQuery)}`;
        logger.info(`Searching Whiskybase for: ${searchQuery}`);

        await this.page!.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Allow Cloudflare challenge / JS execution to complete
        await this.page!.waitForTimeout(3500);

        // Check if bot verification challenge is still running
        const pageContent = await this.page!.content();
        if (pageContent.includes('confirm you are human') && pageContent.includes('challenge-running')) {
          await this.page!.waitForTimeout(4000);
        }

        // Find top bottle link
        const firstMatch: { href: string; name?: string } | null = await this.page!.evaluate(`
          (() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            for (const row of rows) {
              const link = row.querySelector('a[href*="/whiskies/whisky/"]');
              if (!link) continue;
              const href = link.getAttribute('href');
              const name = link.textContent ? link.textContent.trim() : '';
              return { href, name };
            }
            const fallbackLink = document.querySelector('a[href*="/whiskies/whisky/"]');
            if (fallbackLink) {
              return {
                href: fallbackLink.getAttribute('href'),
                name: fallbackLink.textContent ? fallbackLink.textContent.trim() : '',
              };
            }
            return null;
          })()
        `);

        if (!firstMatch || !firstMatch.href) {
          const notFoundResult: WhiskybaseRatingResult = {
            found: false,
            rating: null,
            error: `Whiskybase-hakutulos: Ei löytynyt viskiä haulla "${searchQuery}".`,
            fromCache: false,
          };
          this.memoryCache.set(cacheKey, notFoundResult);
          return notFoundResult;
        }

        targetUrl = firstMatch.href.startsWith('http')
          ? firstMatch.href
          : `https://www.whiskybase.com${firstMatch.href.startsWith('/') ? '' : '/'}${firstMatch.href}`;
      }

      logger.info(`Fetching Whiskybase details from: ${targetUrl}`);

      await this.page!.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await this.page!.waitForTimeout(2500);

      const details: {
        whiskyName: string;
        distillery: string | null;
        rating: number | null;
        votesCount: number;
        whiskybaseId: string | null;
        statedAge: string | null;
        strength: string | null;
      } = await this.page!.evaluate(`
        (() => {
          const titleEl = document.querySelector('h1') || document.querySelector('#whisky-details-title') || document.querySelector('.whisky-page-header');
          const whiskyName = titleEl ? titleEl.textContent.trim().replace(/\\s+/g, ' ') : '';

          let rating = null;
          const ratingEl = document.querySelector('[itemprop="ratingValue"]') || document.querySelector('.whisky-rating') || document.querySelector('.rating-value');
          if (ratingEl) {
            const text = ratingEl.textContent ? ratingEl.textContent.trim() : '';
            const m = text.match(/(\\d{2}(?:\\.\\d{1,2})?)/);
            if (m) rating = parseFloat(m[1]);
          }
          if (rating === null) {
            const bodyText = document.body.innerText;
            const m = bodyText.match(/Overall Rating\\s*[\\n\\r\\s]*(\\d{2}(?:\\.\\d{1,2})?)/i) ||
                      bodyText.match(/(\\d{2}(?:\\.\\d{1,2})?)\\s*\\/\\s*100/);
            if (m) rating = parseFloat(m[1]);
          }

          let votesCount = 0;
          const votesEl = document.querySelector('[itemprop="reviewCount"]') || document.querySelector('.ratings-count') || document.querySelector('.votes-count');
          if (votesEl) {
            const text = votesEl.textContent ? votesEl.textContent.trim() : '';
            const m = text.match(/(\\d[\\d\\s,]*)/);
            if (m) votesCount = parseInt(m[1].replace(/[\\s,]/g, ''), 10);
          }
          if (votesCount === 0) {
            const bodyText = document.body.innerText;
            const m = bodyText.match(/(\\d[\\d\\s,]*)\\s*(?:Ratings|Votes)/i);
            if (m) votesCount = parseInt(m[1].replace(/[\\s,]/g, ''), 10);
          }

          let whiskybaseId = null;
          const urlMatch = window.location.href.match(/\\/whiskies\\/whisky\\/(\\d+)/);
          if (urlMatch) {
            whiskybaseId = 'WB' + urlMatch[1];
          }

          let distillery = null;
          const distLink = document.querySelector('a[href*="/brand/"], a[href*="/distillery/"]');
          if (distLink) {
            distillery = distLink.textContent ? distLink.textContent.trim() : null;
          }

          return {
            whiskyName,
            distillery,
            rating,
            votesCount,
            whiskybaseId,
            statedAge: null,
            strength: null,
          };
        })()
      `);

      if (!details.whiskyName && details.rating === null) {
        return {
          found: false,
          rating: null,
          error: 'Whiskybase-sivun tietojen jäsentäminen epäonnistui.',
          fromCache: false,
        };
      }

      const ratingObj: WhiskybaseRating = {
        whiskyName: details.whiskyName || whiskyName || 'Tuntematon viski',
        distillery: details.distillery || distillery || null,
        rating: details.rating !== null ? details.rating : 0,
        votesCount: details.votesCount || 0,
        whiskybaseId: details.whiskybaseId,
        whiskybaseUrl: targetUrl,
        fetchedAt: new Date(),
      };

      const result: WhiskybaseRatingResult = {
        found: true,
        rating: ratingObj,
        error: null,
        fromCache: false,
      };

      this.memoryCache.set(cacheKey, result);
      logger.info(`Got Whiskybase rating: ${ratingObj.rating}/100 (${ratingObj.votesCount} votes) for ${ratingObj.whiskyName}`);
      return result;
    } catch (error) {
      logger.error('Failed to get Whiskybase rating', { error });
      await this.backoff.wait();
      return {
        found: false,
        rating: null,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        fromCache: false,
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      logger.info('Whiskybase browser closed');
    }
  }

  isInitialized(): boolean {
    return this.browser !== null;
  }
}

// Singleton instance
let whiskybaseScraperInstance: WhiskybaseScraper | null = null;

export function getWhiskybaseScraper(): WhiskybaseScraper {
  if (!whiskybaseScraperInstance) {
    whiskybaseScraperInstance = new WhiskybaseScraper();
  }
  return whiskybaseScraperInstance;
}
