/**
 * Whiskybase rating data types
 */

export interface WhiskybaseRating {
  whiskyName: string;
  distillery: string | null;
  rating: number; // e.g. 86.92 out of 100
  votesCount: number;
  whiskybaseId: string | null; // e.g. "WB51469"
  whiskybaseUrl: string;
  statedAge?: string | null;
  strength?: string | null;
  fetchedAt: Date;
}

export interface StoredWhiskybaseRating {
  cacheKey: string;
  whiskyName: string;
  distillery: string | null;
  rating: number;
  votesCount: number;
  whiskybaseId: string | null;
  whiskybaseUrl: string;
  statedAge?: string | null;
  strength?: string | null;
  fetchedAt: any;
}

export interface WhiskybaseRatingResult {
  found: boolean;
  rating: WhiskybaseRating | null;
  error: string | null;
  fromCache: boolean;
}
