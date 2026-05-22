// Detects bundle/multipack and restricted product signals in Amazon product
// detail page text.  Critical guardrail: "2 tier" / "3 tier" are NOT
// multipacks - they are common organizer descriptors.  The detectors split
// pack-shaped phrases out of "tier"-shaped phrases explicitly.

export interface BundleDetection {
  matched: boolean;
  reason?: string;
  phrase?: string;
}

const TIER_RE = /\b\d+\s*[- ]?\s*(?:tier|tiered|level|levels)\b/i;

// Explicit "N pack(s)" / "N count" patterns. Excludes "tier" by construction.
const PACK_NUM_RE = /\b(\d{1,3})\s*[- ]?\s*(?:packs?|pk|counts?|cts?|pcs?)\b/i;

const BUNDLE_PHRASES: { phrase: string; reason: string }[] = [
  { phrase: 'bundle', reason: 'bundle_keyword' },
  { phrase: 'multipack', reason: 'multipack_keyword' },
  { phrase: 'multi-pack', reason: 'multipack_keyword' },
  { phrase: 'multi pack', reason: 'multipack_keyword' },
  { phrase: 'value pack', reason: 'value_pack' },
  { phrase: 'combo pack', reason: 'combo_pack' },
  { phrase: 'assorted pack', reason: 'assorted_pack' },
  { phrase: 'kit includes', reason: 'kit_includes' },
  { phrase: 'gift set', reason: 'gift_set' },
];

// "set of N" e.g. "set of 4 storage bins".
const SET_OF_RE = /\bset\s+of\s+(\d{1,3})\b/i;

// "pack of N" e.g. "pack of 6".
const PACK_OF_RE = /\bpack\s+of\s+(\d{1,3})\b/i;

export function detectBundleOrMultipack(text: string | undefined | null): BundleDetection {
  if (!text) return { matched: false };
  const cleaned = text.toLowerCase();

  // Strip "tier" / "tiered" phrases first so the pack regex can't see them.
  const withoutTier = cleaned.replace(new RegExp(TIER_RE, 'gi'), ' ');

  const packMatch = withoutTier.match(PACK_NUM_RE);
  if (packMatch) {
    const n = Number(packMatch[1]);
    if (Number.isFinite(n) && n >= 2) {
      return { matched: true, reason: 'numeric_pack', phrase: packMatch[0].trim() };
    }
  }

  for (const { phrase, reason } of BUNDLE_PHRASES) {
    if (withoutTier.includes(phrase)) {
      return { matched: true, reason, phrase };
    }
  }

  const setMatch = withoutTier.match(SET_OF_RE);
  if (setMatch) {
    const n = Number(setMatch[1]);
    if (Number.isFinite(n) && n >= 2) {
      return { matched: true, reason: 'set_of_n', phrase: setMatch[0].trim() };
    }
  }

  const packOfMatch = withoutTier.match(PACK_OF_RE);
  if (packOfMatch) {
    const n = Number(packOfMatch[1]);
    if (Number.isFinite(n) && n >= 2) {
      return { matched: true, reason: 'pack_of_n', phrase: packOfMatch[0].trim() };
    }
  }

  return { matched: false };
}

// ---------------------------------------------------------------------------
// Restricted signals
//
// We classify signals by severity so the caller can attach a specific
// rejection reason code (HAZMAT_SIGNAL, MEDICAL_DEVICE_SIGNAL, etc.).
// ---------------------------------------------------------------------------

export type RestrictedSignalCategory =
  | 'hazmat'
  | 'medical_device'
  | 'food_supplement'
  | 'weapon'
  | 'baby_safety'
  | 'health_beauty'
  | 'restricted_other';

export interface RestrictedSignalHit {
  signal: string;
  phrase: string;
  category: RestrictedSignalCategory;
}

// (category, phrase) tuples. Multi-word phrases first so "tactical knife" wins
// before bare "knife".  Use word boundaries when matching single words.
//
// `scope` controls which page fields are inspected:
//   - 'all' (default): title, bullets, description, warning badges
//   - 'strong': title / warning_badges only - skip bullets, since
//     organizer bullets often list "cosmetic storage" / "shampoo bottle
//     storage" as use cases, which shouldn't reject the organizer itself.
const SIGNALS: { phrase: string; category: RestrictedSignalCategory; word?: boolean; scope?: 'all' | 'strong' }[] = [
  // Hazmat / chemical / explosive
  { phrase: 'hazmat', category: 'hazmat' },
  { phrase: 'hazardous material', category: 'hazmat' },
  { phrase: 'flammable', category: 'hazmat' },
  { phrase: 'explosive', category: 'hazmat' },
  { phrase: 'pesticide', category: 'hazmat' },
  { phrase: 'insecticide', category: 'hazmat' },
  { phrase: 'poison', category: 'hazmat' },
  { phrase: 'corrosive', category: 'hazmat' },
  { phrase: 'lithium battery', category: 'hazmat' },
  { phrase: 'aerosol spray', category: 'hazmat' },
  { phrase: 'lighter fluid', category: 'hazmat' },

  // Medical
  { phrase: 'medical device', category: 'medical_device' },
  { phrase: 'fda-cleared', category: 'medical_device' },
  { phrase: 'fda cleared', category: 'medical_device' },
  { phrase: 'prescription', category: 'medical_device' },
  { phrase: 'oximeter', category: 'medical_device' },
  { phrase: 'glucose meter', category: 'medical_device' },
  { phrase: 'blood pressure monitor', category: 'medical_device' },
  { phrase: 'cpap', category: 'medical_device' },
  { phrase: 'nebulizer', category: 'medical_device' },
  { phrase: 'thermometer', category: 'medical_device' },

  // Food / supplement
  { phrase: 'dietary supplement', category: 'food_supplement' },
  { phrase: 'vitamin', category: 'food_supplement' },
  { phrase: 'protein powder', category: 'food_supplement' },
  { phrase: 'edible', category: 'food_supplement' },
  { phrase: 'grocery', category: 'food_supplement' },
  { phrase: 'snack food', category: 'food_supplement' },
  { phrase: 'baby formula', category: 'food_supplement' },

  // Weapons / self-defense
  { phrase: 'tactical knife', category: 'weapon' },
  { phrase: 'hunting knife', category: 'weapon' },
  { phrase: 'pocket knife', category: 'weapon' },
  { phrase: 'pepper spray', category: 'weapon' },
  { phrase: 'self defense', category: 'weapon' },
  { phrase: 'stun gun', category: 'weapon' },
  { phrase: 'taser', category: 'weapon' },
  { phrase: 'firearm', category: 'weapon' },
  { phrase: 'ammunition', category: 'weapon' },
  { phrase: 'crossbow', category: 'weapon' },
  { phrase: 'switchblade', category: 'weapon' },

  // Baby safety
  { phrase: 'car seat', category: 'baby_safety' },
  { phrase: 'baby crib', category: 'baby_safety' },
  { phrase: 'baby monitor', category: 'baby_safety' },
  { phrase: 'pacifier', category: 'baby_safety' },
  { phrase: 'breast pump', category: 'baby_safety' },

  // Health & beauty - only flag in title / warning badges so organizers
  // that mention "cosmetic storage" or "shampoo bottle holder" as a use
  // case in bullets don't get falsely rejected.
  { phrase: 'cosmetic product', category: 'health_beauty', scope: 'strong' },
  { phrase: 'skincare serum', category: 'health_beauty', scope: 'strong' },
  { phrase: 'shampoo formula', category: 'health_beauty', scope: 'strong' },
  { phrase: 'sunscreen lotion', category: 'health_beauty', scope: 'strong' },
  { phrase: 'topical cream', category: 'health_beauty', scope: 'strong' },
];

// Category-breadcrumb signals - these are very high signal because Amazon's
// own taxonomy says so.
const CATEGORY_HARD_SIGNALS: { phrase: string; category: RestrictedSignalCategory }[] = [
  { phrase: 'health & household', category: 'medical_device' },
  { phrase: 'health & personal care', category: 'medical_device' },
  { phrase: 'beauty & personal care', category: 'health_beauty' },
  { phrase: 'grocery & gourmet food', category: 'food_supplement' },
  { phrase: 'baby products', category: 'baby_safety' },
  { phrase: 'sports & outdoors > hunting', category: 'weapon' },
  { phrase: 'industrial & scientific > pesticides', category: 'hazmat' },
];

export interface RestrictedSignalsResult {
  hits: RestrictedSignalHit[];
  categories: RestrictedSignalCategory[];
}

export function detectRestrictedSignals(args: {
  title?: string;
  bullets?: string[];
  breadcrumbs?: string[];
  warningBadges?: string[];
  description?: string;
}): RestrictedSignalsResult {
  const hits: RestrictedSignalHit[] = [];
  const seenCategories = new Set<RestrictedSignalCategory>();

  const sources: { field: string; text: string }[] = [];
  if (args.title) sources.push({ field: 'title', text: args.title });
  for (const b of args.bullets ?? []) sources.push({ field: 'bullet', text: b });
  for (const w of args.warningBadges ?? []) sources.push({ field: 'warning_badge', text: w });
  if (args.description) sources.push({ field: 'description', text: args.description });

  // Strong category hits from breadcrumbs.
  const breadcrumbBlob = (args.breadcrumbs ?? []).join(' > ').toLowerCase();
  for (const c of CATEGORY_HARD_SIGNALS) {
    if (breadcrumbBlob.includes(c.phrase)) {
      hits.push({ signal: `category:${c.phrase}`, phrase: c.phrase, category: c.category });
      seenCategories.add(c.category);
    }
  }

  for (const src of sources) {
    const lc = src.text.toLowerCase();
    for (const s of SIGNALS) {
      // 'strong' scope phrases only fire from title or warning badges -
      // bullets and description are too noisy (use-case lists trigger
      // false positives on otherwise-fine organizer products).
      if (s.scope === 'strong' && src.field !== 'title' && src.field !== 'warning_badge') continue;
      const re = s.word ? new RegExp(`\\b${escapeRegex(s.phrase)}\\b`, 'i') : null;
      const matched = re ? re.test(lc) : lc.includes(s.phrase);
      if (matched) {
        hits.push({ signal: `${src.field}:${s.phrase}`, phrase: s.phrase, category: s.category });
        seenCategories.add(s.category);
      }
    }
  }

  return { hits, categories: Array.from(seenCategories) };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectAmazonBasicsStrong(args: { title?: string; brand?: string }): boolean {
  const title = (args.title ?? '').toLowerCase();
  const brand = (args.brand ?? '').toLowerCase();
  return (
    title.includes('amazon basics') ||
    title.includes('amazonbasics') ||
    brand === 'amazon basics' ||
    brand === 'amazonbasics' ||
    brand.startsWith('amazon basics ')
  );
}

export function detectUsedRenewedRefurbished(text: string | undefined | null): { matched: boolean; phrase?: string } {
  if (!text) return { matched: false };
  const lc = text.toLowerCase();
  for (const p of ['renewed', 'refurbished', 'open box', 'open-box', 'pre-owned', 'preowned', 'used - like new', 'used - very good', 'used:', 'certified refurbished']) {
    if (lc.includes(p)) return { matched: true, phrase: p };
  }
  return { matched: false };
}
