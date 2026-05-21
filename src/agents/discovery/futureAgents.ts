// Placeholder interfaces for future discovery agents.
// These are intentionally NOT wired into the V1 pipeline.
// Implementations should land alongside the corresponding client in /src/clients.

import type { ProductCandidate } from '@/types/product';

export interface FutureDiscoveryAgent {
  readonly name: string;
  run(input: { discoveryRunId: string }): Promise<{ candidates: ProductCandidate[] }>;
}

export const FUTURE_DISCOVERY_AGENTS: string[] = [
  // Zik
  'ZikCategoryDiscoveryAgent',
  'ZikProductDiscoveryAgent',
  'ZikCompetitorDiscoveryAgent',
  'ZikKeywordDiscoveryAgent',
  'ZikSellThroughAgent',
  'ZikSaturationAgent',
  // Amazon / Keepa
  'AmazonBestSellerAgent',
  'AmazonMoversAgent',
  'KeepaRankMovementAgent',
  'KeepaPriceStabilityAgent',
  // Cross-marketplace radars
  'WalmartRadarAgent',
  'HomeDepotRadarAgent',
  'LowesRadarAgent',
  'WayfairRadarAgent',
  'AliExpressRadarAgent',
  'TemuRadarAgent',
  'TikTokShopRadarAgent',
  'GoogleTrendsRadarAgent',
  // Relationship explorers
  'AdjacentProductAgent',
  'ComplementaryProductAgent',
  'SameProductDifferentBrandAgent',
  'PrivateLabelAlternativeAgent',
];
