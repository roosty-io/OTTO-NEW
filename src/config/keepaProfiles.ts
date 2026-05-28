// Keepa discovery calibration profiles.  Pure config + merge helpers so
// they're unit-testable.  Profiles only tune DISCOVERY INPUT (what Keepa
// returns); they never touch downstream validation gates.

export type KeepaProfileName = 'strict' | 'balanced' | 'broad' | 'exploratory';

export const KEEPA_PROFILE_NAMES: KeepaProfileName[] = ['strict', 'balanced', 'broad', 'exploratory'];

export interface KeepaProfile {
  name: KeepaProfileName;
  minRankImprovementPercent: number;
  minAmazonPrice: number;
  maxAmazonPrice: number;
  /** When true the profile is diagnostics-only and not meant for default exports. */
  diagnosticsOnly: boolean;
  description: string;
}

export const KEEPA_PROFILES: Record<KeepaProfileName, KeepaProfile> = {
  strict: {
    name: 'strict',
    minRankImprovementPercent: 20,
    minAmazonPrice: 12,
    maxAmazonPrice: 150,
    diagnosticsOnly: false,
    description: 'Tight rank movement + price band; safer categories only.',
  },
  balanced: {
    name: 'balanced',
    minRankImprovementPercent: 10,
    minAmazonPrice: 10,
    maxAmazonPrice: 150,
    diagnosticsOnly: false,
    description: 'Moderate rank movement; safer categories only.',
  },
  broad: {
    name: 'broad',
    minRankImprovementPercent: 5,
    minAmazonPrice: 10,
    maxAmazonPrice: 200,
    diagnosticsOnly: false,
    description: 'Loose rank movement + wider price band; leans on downstream gates.',
  },
  exploratory: {
    name: 'exploratory',
    minRankImprovementPercent: 0,
    minAmazonPrice: 5,
    maxAmazonPrice: 300,
    diagnosticsOnly: true,
    description: 'Widest movement/price for diagnostics only; not for default exports. Still excludes prohibited/risky categories.',
  },
};

export function isKeepaProfileName(v: string): v is KeepaProfileName {
  return (KEEPA_PROFILE_NAMES as string[]).includes(v);
}

export function resolveProfile(name?: string): KeepaProfile | null {
  if (!name) return null;
  const lc = name.trim().toLowerCase();
  return isKeepaProfileName(lc) ? KEEPA_PROFILES[lc] : null;
}

export interface KeepaResolvedOptions {
  minRankImprovementPercent: number;
  minAmazonPrice: number;
  maxAmazonPrice: number;
  categorySelector?: string;
  maxAsins: number;
  profileName: KeepaProfileName | 'custom';
  diagnosticsOnly: boolean;
}

export interface KeepaOptionOverrides {
  minRankImprovementPercent?: number;
  minAmazonPrice?: number;
  maxAmazonPrice?: number;
  categorySelector?: string;
  maxAsins?: number;
}

export interface KeepaDefaults {
  minRankImprovementPercent: number;
  minAmazonPrice: number;
  maxAmazonPrice: number;
  maxAsins: number;
}

/**
 * Merge a profile (or env defaults when no profile) with explicit CLI
 * overrides.  Explicit overrides always win.  Returns the fully-resolved
 * Keepa discovery options.
 */
export function mergeKeepaOptions(
  profile: KeepaProfile | null,
  overrides: KeepaOptionOverrides,
  defaults: KeepaDefaults,
): KeepaResolvedOptions {
  const base = profile
    ? {
        minRankImprovementPercent: profile.minRankImprovementPercent,
        minAmazonPrice: profile.minAmazonPrice,
        maxAmazonPrice: profile.maxAmazonPrice,
      }
    : {
        minRankImprovementPercent: defaults.minRankImprovementPercent,
        minAmazonPrice: defaults.minAmazonPrice,
        maxAmazonPrice: defaults.maxAmazonPrice,
      };
  return {
    minRankImprovementPercent: overrides.minRankImprovementPercent ?? base.minRankImprovementPercent,
    minAmazonPrice: overrides.minAmazonPrice ?? base.minAmazonPrice,
    maxAmazonPrice: overrides.maxAmazonPrice ?? base.maxAmazonPrice,
    categorySelector: overrides.categorySelector,
    maxAsins: overrides.maxAsins ?? defaults.maxAsins,
    profileName: profile ? profile.name : 'custom',
    diagnosticsOnly: profile ? profile.diagnosticsOnly : false,
  };
}
