import { stripDiacritics, normalizeText } from '@/utils/normalize';

export interface ComplianceContext {
  ottoProductId: string;
  title: string;
  brand?: string;
  amazonCategory?: string;
  amazonCategoryBreadcrumbs?: string[];
  bullets?: string[];
  descriptionSnippet?: string;
  ebayCategoryHint?: string;
  comparableTitles?: string[];
  coreKeyword?: string;
  relatedKeywords?: string[];
  variationAttributes?: Record<string, string>;
}

export interface NormalizedComplianceText {
  normalizedTitle: string;
  normalizedBrand: string;
  normalizedCategoryText: string;
  normalizedBullets: string[];
  normalizedDescription: string;
  normalizedComparableTitles: string[];
  normalizedKeywords: string[];
  normalizedAllText: string;
  tokens: Set<string>;
}

export function normalizeForCompliance(ctx: ComplianceContext): NormalizedComplianceText {
  const title = norm(ctx.title);
  const brand = norm(ctx.brand);
  const categoryParts = [
    ctx.amazonCategory,
    ...(ctx.amazonCategoryBreadcrumbs ?? []),
    ctx.ebayCategoryHint,
  ].filter((s): s is string => Boolean(s));
  const category = norm(categoryParts.join(' > '));
  const bullets = (ctx.bullets ?? []).map(norm).filter(Boolean);
  const description = norm(ctx.descriptionSnippet);
  const comparables = (ctx.comparableTitles ?? []).map(norm).filter(Boolean);
  const keywords = [ctx.coreKeyword, ...(ctx.relatedKeywords ?? [])]
    .map(norm)
    .filter(Boolean);

  const allParts = [
    title,
    brand,
    category,
    ...bullets,
    description,
    ...comparables,
    ...keywords,
  ].filter(Boolean);
  const all = allParts.join(' | ');

  const tokens = new Set<string>();
  for (const t of tokenize(all)) tokens.add(t);

  return {
    normalizedTitle: title,
    normalizedBrand: brand,
    normalizedCategoryText: category,
    normalizedBullets: bullets,
    normalizedDescription: description,
    normalizedComparableTitles: comparables,
    normalizedKeywords: keywords,
    normalizedAllText: all,
    tokens,
  };
}

function norm(s: string | undefined | null): string {
  return normalizeText(stripDiacritics(s ?? ''));
}

function tokenize(s: string): string[] {
  return s.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Phrase matching helpers
// ---------------------------------------------------------------------------

export interface PhraseMatchOptions {
  /** Require the phrase to appear at a word boundary. Default true for single
   *  tokens, false for multi-word phrases. */
  wholeWord?: boolean;
}

export interface PhraseMatch {
  phrase: string;
  field: 'title' | 'brand' | 'category' | 'bullet' | 'description' | 'comparable' | 'keyword';
  fieldIndex?: number; // for bullets / comparables
  matched: string;
}

export interface FieldedText {
  field: PhraseMatch['field'];
  fieldIndex?: number;
  text: string;
}

export function buildFieldedTexts(n: NormalizedComplianceText): FieldedText[] {
  const out: FieldedText[] = [];
  if (n.normalizedTitle) out.push({ field: 'title', text: n.normalizedTitle });
  if (n.normalizedBrand) out.push({ field: 'brand', text: n.normalizedBrand });
  if (n.normalizedCategoryText) out.push({ field: 'category', text: n.normalizedCategoryText });
  for (let i = 0; i < n.normalizedBullets.length; i++) {
    out.push({ field: 'bullet', fieldIndex: i, text: n.normalizedBullets[i] });
  }
  if (n.normalizedDescription) out.push({ field: 'description', text: n.normalizedDescription });
  for (let i = 0; i < n.normalizedComparableTitles.length; i++) {
    out.push({ field: 'comparable', fieldIndex: i, text: n.normalizedComparableTitles[i] });
  }
  for (let i = 0; i < n.normalizedKeywords.length; i++) {
    out.push({ field: 'keyword', fieldIndex: i, text: n.normalizedKeywords[i] });
  }
  return out;
}

export interface MatchPhrasesArgs {
  phrases: string[];
  fields: FieldedText[];
  scope?: 'all' | 'title';
}

/**
 * Find every occurrence of any phrase in any field, respecting word
 * boundaries for short (<= 4 char) single-token phrases.  Multi-word
 * phrases match as substrings since they are self-contextualizing.
 */
export function findPhraseMatches(args: MatchPhrasesArgs): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  const phrases = args.phrases.map((p) => normalizeText(stripDiacritics(p)));
  for (const phrase of phrases) {
    if (!phrase) continue;
    const isMultiWord = phrase.includes(' ');
    const wholeWord = !isMultiWord && phrase.length <= 6;
    const re = wholeWord
      ? new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i')
      : null;
    for (const f of args.fields) {
      if (args.scope === 'title' && f.field !== 'title' && f.field !== 'category' && f.field !== 'brand') continue;
      const text = f.text;
      const matched = re ? re.test(text) : text.includes(phrase);
      if (matched) {
        out.push({ phrase, field: f.field, fieldIndex: f.fieldIndex, matched: phrase });
      }
    }
  }
  return out;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect whether two phrases co-occur in the same field within `windowChars`
 * characters of each other.  Used by the CompatibilityFitmentAgent to score
 * "compatible with iPhone" vs "compatible with kitchen drawers".
 */
export function findPhraseCoOccurrence(
  haystack: string,
  a: string,
  b: string,
  windowChars = 30,
): boolean {
  const hay = haystack.toLowerCase();
  const ai = hay.indexOf(a.toLowerCase());
  if (ai < 0) return false;
  const bi = hay.indexOf(b.toLowerCase(), Math.max(0, ai - windowChars));
  if (bi < 0) return false;
  return Math.abs(bi - ai) <= windowChars;
}
