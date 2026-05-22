import type { ProductCandidate } from '@/types/product';
import { normalizeText, stripDiacritics } from '@/utils/normalize';

// Stopwords and noise we strip when generating "simplified" queries.
const NOISE_TOKENS = new Set([
  'new', 'hot', 'sale', 'free', 'shipping', 'usa', 'us', 'official', 'best',
  'top', 'premium', 'high', 'quality', 'durable', 'large', 'small', 'mini',
  'set', 'kit', 'pack', 'piece', 'pieces', 'pcs', 'ct', 'count', 'tier',
  'with', 'and', 'for', 'the', 'a', 'an', 'in', 'of', 'to', 'by',
]);

const COLOR_TOKENS = new Set([
  'black', 'white', 'gray', 'grey', 'silver', 'gold', 'beige', 'brown', 'red',
  'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'clear', 'transparent',
]);

const SIZE_TOKENS = new Set([
  'inch', 'inches', 'cm', 'mm', 'ft', 'foot', 'feet', 'oz', 'lb', 'lbs',
  'kg', 'gallon', 'litre', 'liter', 'gal',
]);

const PACK_RE = /\b\d+\s*(?:pk|pack|pcs?|count|ct|tier)\b/gi;

export interface QueryStrategy {
  label: string;
  query: string;
}

export function buildAmazonQueries(candidate: ProductCandidate, maxQueries = 4): QueryStrategy[] {
  const rawTitle = (candidate.productTitleRaw ?? '').trim();
  const brand = (candidate.brandHint ?? '').trim();
  const keyword = (candidate.keyword ?? '').trim();
  const category = (candidate.categoryHint ?? '').trim();

  const strategies: QueryStrategy[] = [];
  const add = (label: string, value: string | undefined) => {
    const q = sanitize(value ?? '');
    if (!q) return;
    if (strategies.some((s) => s.query === q)) return;
    strategies.push({ label, query: q });
  };

  add('original_title', rawTitle);
  add('normalized_title', normalizeTitle(rawTitle));
  if (brand) add('brand_removed', removeBrand(rawTitle, brand));
  add('core_keyword', keyword);
  add('simplified_noun_phrase', simplifiedNounPhrase(rawTitle));
  if (category) add('category_plus_keyword', `${keyword} ${category}`.trim());

  return strategies.slice(0, maxQueries);
}

function sanitize(s: string): string {
  if (!s) return '';
  const collapsed = stripDiacritics(s)
    .replace(/[|/\\<>()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Amazon URL-encodes queries; keep them under ~120 chars for safety.
  return collapsed.length > 120 ? collapsed.slice(0, 120).trim() : collapsed;
}

export function normalizeTitle(title: string): string {
  if (!title) return '';
  const tokens = tokenize(title);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 12).join(' ');
}

export function removeBrand(title: string, brand: string): string {
  if (!brand) return title;
  const b = normalizeText(brand);
  return tokenize(title).filter((t) => t !== b && !b.includes(t)).slice(0, 12).join(' ');
}

export function simplifiedNounPhrase(title: string): string {
  if (!title) return '';
  const clean = title.replace(PACK_RE, ' ');
  const tokens = tokenize(clean).filter((t) => {
    if (NOISE_TOKENS.has(t)) return false;
    if (COLOR_TOKENS.has(t)) return false;
    if (SIZE_TOKENS.has(t)) return false;
    if (/^\d+(\.\d+)?$/.test(t)) return false; // bare numbers
    return true;
  });
  return tokens.slice(0, 6).join(' ');
}

export function tokenize(s: string): string[] {
  return normalizeText(stripDiacritics(s))
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
