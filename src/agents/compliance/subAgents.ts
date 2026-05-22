import {
  BLACKLIST_PHRASES,
  BRAND_ENTRIES,
  type BrandEntry,
} from '@/config/categories';
import { clamp } from '@/utils/scoring';
import { detectBundleOrMultipack } from '@/utils/productRiskText';
import {
  buildFieldedTexts,
  findPhraseCoOccurrence,
  findPhraseMatches,
  normalizeForCompliance,
  type ComplianceContext,
  type NormalizedComplianceText,
  type PhraseMatch,
} from '@/utils/complianceTextNormalizer';
import { RejectionReason } from '@/utils/rejectionReasons';
import type { ComplianceSubResult, ComplianceBucket } from '@/utils/complianceRiskModel';

// Re-export for the council.
export type { ComplianceContext } from '@/utils/complianceTextNormalizer';

export interface SubAgentInput {
  ctx: ComplianceContext;
  normalized: NormalizedComplianceText;
}

export type ComplianceSubAgentFn = (input: SubAgentInput) => ComplianceSubResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function build(args: {
  agentName: string;
  bucket: ComplianceBucket;
  matches: PhraseMatch[];
  reasonCode: string;
  hardBlockOnMatch: boolean;
  baseScoreOnMatch?: number;
  notes?: string;
}): ComplianceSubResult {
  const matchedTerms = uniq(args.matches.map((m) => m.matched));
  if (matchedTerms.length === 0) {
    return {
      agentName: args.agentName,
      status: 'pass',
      scoreContribution: 0,
      bucket: args.bucket,
      matchedTerms: [],
      reasonCodes: [],
      notes: '',
      hardBlock: false,
    };
  }
  const titleMatch = args.matches.some((m) => m.field === 'title' || m.field === 'brand' || m.field === 'category');
  const status: ComplianceSubResult['status'] = args.hardBlockOnMatch
    ? 'fail'
    : titleMatch
      ? 'manual_review'
      : 'warning';
  // Title matches always score full; out-of-title matches get half.
  const base = args.baseScoreOnMatch ?? (args.hardBlockOnMatch ? 100 : 60);
  const scoreContribution = clamp(titleMatch ? base : base * 0.7);
  return {
    agentName: args.agentName,
    status,
    scoreContribution,
    bucket: args.bucket,
    matchedTerms,
    reasonCodes: [args.reasonCode],
    notes: args.notes ?? args.matches.map((m) => `${m.field}: "${m.matched}"`).slice(0, 4).join('; '),
    hardBlock: args.hardBlockOnMatch && status === 'fail',
  };
}

function passResult(agentName: string, bucket: ComplianceBucket): ComplianceSubResult {
  return {
    agentName,
    status: 'pass',
    scoreContribution: 0,
    bucket,
    matchedTerms: [],
    reasonCodes: [],
    notes: '',
    hardBlock: false,
  };
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function brandsByCategory(cat: BrandEntry['category']): string[] {
  return BRAND_ENTRIES.filter((b) => b.category === cat)
    .flatMap((b) => [b.brand, ...(b.aliases ?? [])]);
}

function phrasesByCategory(cat: string): string[] {
  return BLACKLIST_PHRASES.filter((p) => p.category === cat).map((p) => p.phrase);
}

function phrasesByCategoryWithScope(cat: string, scope: 'title' | 'all'): string[] {
  return BLACKLIST_PHRASES
    .filter((p) => p.category === cat && ((p.scope ?? 'all') === scope || scope === 'all'))
    .map((p) => p.phrase);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const VeroBrandAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // Brand-style matches across electronics, luxury, athletic apparel, sport
  // leagues, and the home-brand bucket. Copyright characters get their own
  // dedicated agent so we don't overcount the same hit twice.
  const brands = BRAND_ENTRIES.filter(
    (b) => b.category && ['vero', 'electronics', 'luxury', 'sport_league', 'home_brand', 'general'].includes(b.category),
  ).flatMap((b) => [b.brand, ...(b.aliases ?? [])]);
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: brands, fields });
  return build({
    agentName: 'VeroBrandAgent',
    bucket: 'vero',
    matches,
    reasonCode: RejectionReason.VERO_BRAND_MATCH,
    hardBlockOnMatch: true,
  });
};

export const TrademarkKeywordAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const phrases = phrasesByCategory('trademark');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases, fields });
  if (matches.length === 0) return passResult('TrademarkKeywordAgent', 'ip');
  // "official", "authentic", etc. are soft signals - manual_review only.
  return {
    agentName: 'TrademarkKeywordAgent',
    status: 'manual_review',
    scoreContribution: clamp(30 + matches.length * 5),
    bucket: 'ip',
    matchedTerms: uniq(matches.map((m) => m.matched)),
    reasonCodes: [RejectionReason.TRADEMARK_KEYWORD_MATCH],
    notes: matches.map((m) => `${m.field}: "${m.matched}"`).slice(0, 4).join('; '),
    hardBlock: false,
  };
};

export const CopyrightCharacterAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const brands = brandsByCategory('copyright');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: brands, fields });
  return build({
    agentName: 'CopyrightCharacterAgent',
    bucket: 'ip',
    matches,
    reasonCode: RejectionReason.COPYRIGHT_CHARACTER_MATCH,
    hardBlockOnMatch: true,
  });
};

export const CounterfeitReplicaAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const phrases = phrasesByCategory('counterfeit');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases, fields });
  return build({
    agentName: 'CounterfeitReplicaAgent',
    bucket: 'ip',
    matches,
    reasonCode: RejectionReason.COUNTERFEIT_REPLICA_LANGUAGE,
    hardBlockOnMatch: true,
  });
};

export const RestrictedCategoryAgent: ComplianceSubAgentFn = ({ ctx, normalized }) => {
  // Restricted-category hits come from the breadcrumb / Amazon category text,
  // not from arbitrary mentions in bullets.
  const categoryBlob = normalized.normalizedCategoryText;
  const restricted = [
    'health & beauty', 'medical devices', 'supplements', 'food', 'grocery',
    'cosmetics', 'baby safety', 'car seats', 'weapons', 'firearms',
    'self-defense', 'hazardous materials', 'pesticides', 'chemicals',
    'luxury brands', 'fashion', 'branded electronics accessories',
    'software', 'digital goods', 'trading cards', 'collectibles',
    'automotive parts',
  ];
  const matches: PhraseMatch[] = [];
  for (const r of restricted) {
    if (categoryBlob.includes(r)) {
      matches.push({ phrase: r, field: 'category', matched: r });
    }
  }
  return build({
    agentName: 'RestrictedCategoryAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.RESTRICTED_CATEGORY_MATCH,
    hardBlockOnMatch: true,
  });
  void ctx;
};

export const MedicalDeviceAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const phrases = phrasesByCategory('medical');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases, fields });
  return build({
    agentName: 'MedicalDeviceAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.MEDICAL_DEVICE_RISK,
    hardBlockOnMatch: true,
  });
};

export const SupplementFoodAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // Strong phrases everywhere; soft single-words only in title/brand/category.
  const fields = buildFieldedTexts(normalized);
  const strong = findPhraseMatches({
    phrases: BLACKLIST_PHRASES.filter((p) => p.category === 'food_supplement' && (p.scope ?? 'all') === 'all').map((p) => p.phrase),
    fields,
  });
  const soft = findPhraseMatches({
    phrases: BLACKLIST_PHRASES.filter((p) => p.category === 'food_supplement' && p.scope === 'title').map((p) => p.phrase),
    fields,
    scope: 'title',
  });
  const matches = [...strong, ...soft];
  return build({
    agentName: 'SupplementFoodAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.SUPPLEMENT_FOOD_RISK,
    hardBlockOnMatch: matches.length > 0,
  });
};

export const HazardousMaterialAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const phrases = phrasesByCategory('hazmat');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases, fields });
  return build({
    agentName: 'HazardousMaterialAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.HAZMAT_RISK,
    hardBlockOnMatch: true,
  });
};

export const WeaponSelfDefenseAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // Strong phrases ("pepper spray", "tactical knife", "self defense", etc.)
  // are unambiguous and fail.  Bare "knife" alone is too noisy ("knife block
  // organizer", "kitchen knife holder") so we only flag the bare token when
  // the title literally IS the weapon and the noun is not paired with a
  // benign container word like organizer / holder / block / drawer.
  const strong = phrasesByCategory('weapon');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: strong, fields });

  const titleLc = normalized.normalizedTitle;
  const bareKnife = /\bknife\b/.test(titleLc);
  const benignContext = /(organizer|holder|block|rack|drawer|magnet|sharp|sharpener|board|case|cover|sheath\sguard)/i.test(titleLc);
  if (bareKnife && !benignContext && matches.length === 0) {
    matches.push({ phrase: 'knife', field: 'title', matched: 'knife' });
  }

  return build({
    agentName: 'WeaponSelfDefenseAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.WEAPON_SELF_DEFENSE_RISK,
    hardBlockOnMatch: true,
  });
};

export const BabySafetyAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const phrases = phrasesByCategory('baby_safety');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases, fields });
  return build({
    agentName: 'BabySafetyAgent',
    bucket: 'restricted',
    matches,
    reasonCode: RejectionReason.BABY_SAFETY_RISK,
    hardBlockOnMatch: true,
  });
};

export const ElectronicsBrandAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const brands = brandsByCategory('electronics');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: brands, fields });
  return build({
    agentName: 'ElectronicsBrandAgent',
    bucket: 'ip',
    matches,
    reasonCode: RejectionReason.BRANDED_ELECTRONICS_RISK,
    hardBlockOnMatch: true,
  });
};

export const LuxuryFashionAgent: ComplianceSubAgentFn = ({ normalized }) => {
  const brands = brandsByCategory('luxury');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: brands, fields });
  return build({
    agentName: 'LuxuryFashionAgent',
    bucket: 'ip',
    matches,
    reasonCode: RejectionReason.LUXURY_FASHION_RISK,
    hardBlockOnMatch: true,
  });
};

export const CompatibilityFitmentAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // Context-aware: "compatible with iPhone" / "replacement for Apple" => fail.
  // "compatible with most kitchen drawers" => pass.
  const compatPhrases = phrasesByCategory('compatibility');
  const fields = buildFieldedTexts(normalized);
  const compatMatches = findPhraseMatches({ phrases: compatPhrases, fields });
  if (compatMatches.length === 0) return passResult('CompatibilityFitmentAgent', 'edge_case');

  // Look for an ecosystem brand within 30 chars of a compatibility phrase
  // in title / brand / bullet text.
  const ecosystemBrands = BRAND_ENTRIES.filter((b) =>
    ['electronics', 'luxury', 'sport_league', 'home_brand', 'copyright'].includes(b.category ?? 'general'),
  ).flatMap((b) => [b.brand, ...(b.aliases ?? [])]);

  const haystacks = [normalized.normalizedTitle, ...normalized.normalizedBullets, normalized.normalizedDescription].filter(Boolean);
  let ecosystemHit: string | null = null;
  for (const compat of compatMatches.map((m) => m.matched)) {
    for (const brand of ecosystemBrands) {
      for (const hay of haystacks) {
        if (findPhraseCoOccurrence(hay, compat, brand.toLowerCase(), 40)) {
          ecosystemHit = brand;
          break;
        }
      }
      if (ecosystemHit) break;
    }
    if (ecosystemHit) break;
  }

  if (ecosystemHit) {
    return {
      agentName: 'CompatibilityFitmentAgent',
      status: 'fail',
      scoreContribution: 90,
      bucket: 'ip',
      matchedTerms: uniq([...compatMatches.map((m) => m.matched), ecosystemHit]),
      reasonCodes: [RejectionReason.COMPATIBILITY_FITMENT_RISK, RejectionReason.IP_RISK_DETECTED],
      notes: `Compatibility hint paired with ecosystem brand: ${ecosystemHit}`,
      hardBlock: true,
    };
  }

  // Compatibility phrase alone (no ecosystem brand) is a soft signal.
  return {
    agentName: 'CompatibilityFitmentAgent',
    status: 'warning',
    scoreContribution: 20,
    bucket: 'edge_case',
    matchedTerms: uniq(compatMatches.map((m) => m.matched)),
    reasonCodes: [RejectionReason.COMPATIBILITY_FITMENT_RISK],
    notes: 'Compatibility / fitment language detected without an ecosystem brand pairing',
    hardBlock: false,
  };
};

export const BrandStrengthAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // Strong home-brand / lifestyle brands that are protected even if not VeRO.
  const brands = brandsByCategory('home_brand');
  const fields = buildFieldedTexts(normalized);
  const matches = findPhraseMatches({ phrases: brands, fields });
  if (matches.length === 0) return passResult('BrandStrengthAgent', 'vero');
  // BrandStrength overlaps with VeroBrand for these; the council de-dupes
  // matched terms, so we surface a softer status here.
  return {
    agentName: 'BrandStrengthAgent',
    status: 'manual_review',
    scoreContribution: 60,
    bucket: 'vero',
    matchedTerms: uniq(matches.map((m) => m.matched)),
    reasonCodes: [RejectionReason.STRONG_BRAND_ENFORCEMENT_RISK],
    notes: `Strong consumer brand: ${matches[0].matched}`,
    hardBlock: false,
  };
};

export const PolicyMemoryAgent: ComplianceSubAgentFn = ({ normalized }) => {
  // V1 starter: detect bundle/multipack language as a remembered-rejection
  // pattern.  A future iteration will query rejected_products for the same
  // brand/category and surface historical rejection rates.
  const titleBundle = detectBundleOrMultipack(normalized.normalizedTitle);
  const bulletBundles = normalized.normalizedBullets
    .map((b) => detectBundleOrMultipack(b))
    .filter((d) => d.matched);
  const hits: string[] = [];
  const codes: string[] = [];
  if (titleBundle.matched) {
    hits.push(titleBundle.phrase ?? 'bundle/multipack');
    codes.push(RejectionReason.POLICY_MEMORY_MATCH);
  }
  if (bulletBundles.length > 0 && !titleBundle.matched) {
    hits.push(bulletBundles[0].phrase ?? 'bundle/multipack');
    codes.push(RejectionReason.AMBIGUOUS_POLICY_RISK);
  }
  if (hits.length === 0) return passResult('PolicyMemoryAgent', 'edge_case');
  return {
    agentName: 'PolicyMemoryAgent',
    status: titleBundle.matched ? 'manual_review' : 'warning',
    scoreContribution: titleBundle.matched ? 40 : 20,
    bucket: 'edge_case',
    matchedTerms: hits,
    reasonCodes: codes,
    notes: titleBundle.matched ? 'Title resembles a historically rejected bundle/multipack pattern' : 'Bundle/multipack language in bullets',
    hardBlock: false,
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_COMPLIANCE_AGENTS: { name: string; fn: ComplianceSubAgentFn }[] = [
  { name: 'VeroBrandAgent', fn: VeroBrandAgent },
  { name: 'TrademarkKeywordAgent', fn: TrademarkKeywordAgent },
  { name: 'CopyrightCharacterAgent', fn: CopyrightCharacterAgent },
  { name: 'CounterfeitReplicaAgent', fn: CounterfeitReplicaAgent },
  { name: 'RestrictedCategoryAgent', fn: RestrictedCategoryAgent },
  { name: 'MedicalDeviceAgent', fn: MedicalDeviceAgent },
  { name: 'SupplementFoodAgent', fn: SupplementFoodAgent },
  { name: 'HazardousMaterialAgent', fn: HazardousMaterialAgent },
  { name: 'WeaponSelfDefenseAgent', fn: WeaponSelfDefenseAgent },
  { name: 'BabySafetyAgent', fn: BabySafetyAgent },
  { name: 'ElectronicsBrandAgent', fn: ElectronicsBrandAgent },
  { name: 'LuxuryFashionAgent', fn: LuxuryFashionAgent },
  { name: 'CompatibilityFitmentAgent', fn: CompatibilityFitmentAgent },
  { name: 'BrandStrengthAgent', fn: BrandStrengthAgent },
  { name: 'PolicyMemoryAgent', fn: PolicyMemoryAgent },
];

// Backwards-compat: previous council code looked up `ALL_COMPLIANCE_AGENTS`
// expecting it to provide normalized text to each agent.  The new entry
// point is `runComplianceAgents` below.
export function runComplianceAgents(ctx: ComplianceContext): ComplianceSubResult[] {
  const normalized = normalizeForCompliance(ctx);
  return ALL_COMPLIANCE_AGENTS.map(({ fn }) => fn({ ctx, normalized }));
}
