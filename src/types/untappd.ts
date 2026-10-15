/**
 * Untappd rating data types
 */

export interface UntappdRating {
  beerName: string;
  brewery: string | null;
  averageRating: number; // e.g. 3.49 (out of 5.0)
  ratingsCount: number;
  untappdUrl: string;
  style?: string | null;
  abv?: number | null;
  fetchedAt: Date;
}

export interface UntappdRatingResult {
  found: boolean;
  rating: UntappdRating | null;
  alternativeMatches?: Array<{
    beerName: string;
    brewery: string | null;
    rating: number | null;
    ratingsCount: number;
    untappdUrl: string;
    abv?: number | null;
  }>;
  error: string | null;
  fromCache: boolean;
}
