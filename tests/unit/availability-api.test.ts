import { describe, it, expect } from 'vitest';
import type { AvailabilityApiResponse } from '../../src/services/scraper.js';

/**
 * Replicates parseAvailabilityApiResponse from scraper.ts for unit testing
 * without importing Firestore dependencies.
 */
function parseAvailabilityApiResponse(
  productId: string,
  apiData: AvailabilityApiResponse[]
): Array<{
  id: string;
  productId: string;
  storeId: string;
  storeName: string;
  storeLink: string;
  quantity: number;
  status: 'in_stock' | 'low_stock' | 'out_of_stock';
  lastUpdated: string;
}> {
  if (!Array.isArray(apiData)) {
    return [];
  }

  return apiData
    .filter((item) => item.count > 0)
    .map((item) => {
      const quantity = item.count;
      return {
        id: `${productId}_${item.id}`,
        productId,
        storeId: item.id,
        storeName: item.storeName,
        storeLink: `/fi/myymalat-palvelut/${item.id}`,
        quantity,
        status: (quantity > 5 ? 'in_stock' : quantity > 0 ? 'low_stock' : 'out_of_stock') as 'in_stock' | 'low_stock' | 'out_of_stock',
        lastUpdated: '',
      };
    });
}

// Realistic test data based on actual API responses from alko.fi
const sampleApiResponse: AvailabilityApiResponse[] = [
  {
    id: '2224',
    count: 12,
    storeName: 'Mynämäki',
    outletType: '1',
    address: 'Valtakatu 1',
    latitude: 60.684807,
    longitude: 21.989079,
    openHours: [
      { hours: '9–21', date: '2026-03-06' },
      { hours: '9–18', date: '2026-03-07' },
      { hours: 'kiinni', date: '2026-03-08' },
    ],
    city: 'Mynämäki',
    postalCode: '23100',
    open: true,
  },
  {
    id: '2208',
    count: 15,
    storeName: 'Turku keskusta Stockmann',
    outletType: '1',
    address: 'Yliopistonkatu 22',
    latitude: 60.450881,
    longitude: 22.262909,
    openHours: [
      { hours: '9–21', date: '2026-03-06' },
      { hours: '9–18', date: '2026-03-07' },
    ],
    city: 'Turku',
    postalCode: '20100',
    open: true,
  },
  {
    id: '2440',
    count: 4,
    storeName: 'Akaa Toijala',
    outletType: '1',
    address: 'Valtatie 1',
    latitude: 61.200000,
    longitude: 23.800000,
    openHours: [
      { hours: '9–21', date: '2026-03-06' },
    ],
    city: 'Akaa',
    postalCode: '37800',
    open: true,
  },
  {
    id: '3001',
    count: 0,
    storeName: 'Helsinki Kamppi',
    outletType: '1',
    address: 'Urho Kekkosen katu 1',
    latitude: 60.168900,
    longitude: 24.932500,
    openHours: [],
    city: 'Helsinki',
    postalCode: '00100',
    open: false,
  },
];

describe('Availability API Response Parsing', () => {
  it('should parse a typical API response into StoreAvailability entries', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    // Should exclude the store with count 0 (Helsinki Kamppi)
    expect(result).toHaveLength(3);
  });

  it('should set correct composite IDs', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    expect(result[0].id).toBe('004246_2224');
    expect(result[1].id).toBe('004246_2208');
    expect(result[2].id).toBe('004246_2440');
  });

  it('should set productId on all entries', () => {
    const result = parseAvailabilityApiResponse('906458', sampleApiResponse);

    result.forEach((store) => {
      expect(store.productId).toBe('906458');
    });
  });

  it('should use exact count from API as quantity', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    expect(result[0].quantity).toBe(12);
    expect(result[1].quantity).toBe(15);
    expect(result[2].quantity).toBe(4);
  });

  it('should set status based on quantity thresholds', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    // quantity > 5 => in_stock
    expect(result[0].status).toBe('in_stock');  // 12
    expect(result[1].status).toBe('in_stock');  // 15

    // 0 < quantity <= 5 => low_stock
    expect(result[2].status).toBe('low_stock'); // 4
  });

  it('should filter out stores with zero stock', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    const storeNames = result.map((s) => s.storeName);
    expect(storeNames).not.toContain('Helsinki Kamppi');
  });

  it('should construct store links from store ID', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    expect(result[0].storeLink).toBe('/fi/myymalat-palvelut/2224');
    expect(result[1].storeLink).toBe('/fi/myymalat-palvelut/2208');
  });

  it('should preserve store names exactly as returned from API', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    expect(result[0].storeName).toBe('Mynämäki');
    expect(result[1].storeName).toBe('Turku keskusta Stockmann');
    expect(result[2].storeName).toBe('Akaa Toijala');
  });

  it('should return empty array for empty API response', () => {
    const result = parseAvailabilityApiResponse('004246', []);

    expect(result).toEqual([]);
  });

  it('should return empty array for non-array input', () => {
    // Defensive: API might return unexpected data
    const result = parseAvailabilityApiResponse('004246', null as unknown as AvailabilityApiResponse[]);

    expect(result).toEqual([]);
  });

  it('should return empty array when all stores have zero stock', () => {
    const allZero: AvailabilityApiResponse[] = [
      {
        id: '3001',
        count: 0,
        storeName: 'Helsinki Kamppi',
        outletType: '1',
        address: 'Urho Kekkosen katu 1',
        latitude: 60.168900,
        longitude: 24.932500,
        openHours: [],
        city: 'Helsinki',
        postalCode: '00100',
        open: false,
      },
      {
        id: '3002',
        count: 0,
        storeName: 'Helsinki Itäkeskus',
        outletType: '1',
        address: 'Itäkatu 1',
        latitude: 60.210000,
        longitude: 25.080000,
        openHours: [],
        city: 'Helsinki',
        postalCode: '00930',
        open: false,
      },
    ];

    const result = parseAvailabilityApiResponse('004246', allZero);
    expect(result).toEqual([]);
  });

  it('should handle store with exactly 1 item (low_stock)', () => {
    const singleItem: AvailabilityApiResponse[] = [
      {
        id: '9999',
        count: 1,
        storeName: 'Utsjoki',
        outletType: '1',
        address: 'Koskitie 1',
        latitude: 69.900000,
        longitude: 27.000000,
        openHours: [],
        city: 'Utsjoki',
        postalCode: '99980',
        open: true,
      },
    ];

    const result = parseAvailabilityApiResponse('004246', singleItem);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('low_stock');
    expect(result[0].quantity).toBe(1);
  });

  it('should handle store with exactly 5 items (low_stock boundary)', () => {
    const fiveItems: AvailabilityApiResponse[] = [
      {
        id: '9998',
        count: 5,
        storeName: 'Inari',
        outletType: '1',
        address: 'Inarintie 1',
        latitude: 69.000000,
        longitude: 27.000000,
        openHours: [],
        city: 'Inari',
        postalCode: '99870',
        open: true,
      },
    ];

    const result = parseAvailabilityApiResponse('004246', fiveItems);
    expect(result[0].status).toBe('low_stock');
  });

  it('should handle store with exactly 6 items (in_stock boundary)', () => {
    const sixItems: AvailabilityApiResponse[] = [
      {
        id: '9997',
        count: 6,
        storeName: 'Sodankylä',
        outletType: '1',
        address: 'Jäämerentie 1',
        latitude: 67.400000,
        longitude: 26.600000,
        openHours: [],
        city: 'Sodankylä',
        postalCode: '99600',
        open: true,
      },
    ];

    const result = parseAvailabilityApiResponse('004246', sixItems);
    expect(result[0].status).toBe('in_stock');
  });

  it('should handle large response (341 stores)', () => {
    const manyStores: AvailabilityApiResponse[] = Array.from({ length: 341 }, (_, i) => ({
      id: String(1000 + i),
      count: Math.max(1, i % 30),
      storeName: `Store ${i}`,
      outletType: '1',
      address: `Street ${i}`,
      latitude: 60 + i * 0.01,
      longitude: 24 + i * 0.01,
      openHours: [],
      city: `City ${i % 10}`,
      postalCode: String(10000 + i),
      open: true,
    }));

    const result = parseAvailabilityApiResponse('004246', manyStores);
    expect(result.length).toBe(341);
    // All should have valid IDs
    result.forEach((store) => {
      expect(store.id).toMatch(/^004246_\d+$/);
    });
  });
});

describe('Availability API Response - Data Integrity', () => {
  it('should set lastUpdated to empty string (API does not provide this)', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    result.forEach((store) => {
      expect(store.lastUpdated).toBe('');
    });
  });

  it('should use store ID from API, not extract from URL', () => {
    const result = parseAvailabilityApiResponse('004246', sampleApiResponse);

    expect(result[0].storeId).toBe('2224');
    expect(result[1].storeId).toBe('2208');
    expect(result[2].storeId).toBe('2440');
  });
});
