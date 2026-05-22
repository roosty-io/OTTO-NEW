import { stripDiacritics, normalizeText } from '@/utils/normalize';

// Query generator for eBay demand validation.
//
// Given an Amazon product (title + brand + breadcrumbs + core keyword),
// produce a small set of eBay Browse-API search queries that look at the
// product from different angles: the exact-shape title, the keyword, the
// category+type phrase, and a same-use-case phrase. Diverse queries help
// the engine see whether demand exists for the product itself OR a close
// alternative (V1 allows ADJACENT_ALTERNATIVE / CATEGORY_GAP outcomes).

const NOISE_TOKENS = new Set([
  'new', 'hot', 'sale', 'free', 'shipping', 'usa', 'us', 'official', 'best',
  'top', 'premium', 'high', 'quality', 'durable', 'large', 'small', 'mini',
  'set', 'kit', 'pack', 'piece', 'pieces', 'pcs', 'ct', 'count',
  'with', 'and', 'for', 'the', 'a', 'an', 'in', 'of', 'to', 'by', 'or',
  'home', 'kitchen', 'use', 'item',
]);

const COLOR_TOKENS = new Set([
  'black', 'white', 'gray', 'grey', 'silver', 'gold', 'beige', 'brown',
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'clear',
  'transparent',
]);

const SIZE_TOKENS = new Set(['inch', 'inches', 'cm', 'mm', 'ft', 'foot', 'feet', 'oz', 'lb', 'lbs', 'kg']);

const PACK_RE = /\b\d+\s*(?:pk|pack|pcs?|count|ct|tier|tiers?)\b/gi;

export interface EbayQueryStrategy {
  label: string;
  query: string;
}

export interface EbayQueryInput {
  amazonTitle?: string;
  amazonBrand?: string;
  amazonCategoryBreadcrumbs?: string[];
  coreKeyword?: string;
}

export function buildEbayDemandQueries(input: EbayQueryInput, maxQueries = 6): EbayQueryStrategy[] {
  const title = (input.amazonTitle ?? '').trim();
  const brand = (input.amazonBrand ?? '').trim();
  const keyword = (input.coreKeyword ?? '').trim();
  const breadcrumbs = (input.amazonCategoryBreadcrumbs ?? []).filter(Boolean);

  const strategies: EbayQueryStrategy[] = [];
  const add = (label: string, value: string | undefined) => {
    const q = sanitize(value ?? '');
    if (!q) return;
    if (strategies.some((s) => s.query === q)) return;
    strategies.push({ label, query: q });
  };

  add('core_keyword', keyword);
  add('normalized_title', normalizeTitleForQuery(title));
  if (brand) add('title_without_brand', removeBrand(title, brand));
  add('simplified_noun_phrase', simplifiedNounPhrase(title));
  if (breadcrumbs.length > 0) {
    const cat = breadcrumbs[breadcrumbs.length - 1];
    if (keyword) add('category_plus_keyword', `${keyword} ${cat}`.trim());
  }
  add('use_case_phrase', useCasePhrase(title));

  return strategies.slice(0, maxQueries);
}

function sanitize(s: string): string {
  if (!s) return '';
  return stripDiacritics(s)
    .replace(/[|/\\<>()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
}

function normalizeTitleForQuery(title: string): string {
  if (!title) return '';
  const tokens = tokenize(title);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 10).join(' ');
}

function removeBrand(title: string, brand: string): string {
  if (!brand) return title;
  const b = normalizeText(brand);
  return tokenize(title).filter((t) => t !== b && !b.includes(t)).slice(0, 10).join(' ');
}

function simplifiedNounPhrase(title: string): string {
  if (!title) return '';
  const clean = title.replace(PACK_RE, ' ');
  const tokens = tokenize(clean).filter((t) => {
    if (NOISE_TOKENS.has(t)) return false;
    if (COLOR_TOKENS.has(t)) return false;
    if (SIZE_TOKENS.has(t)) return false;
    if (/^\d+(\.\d+)?$/.test(t)) return false;
    return true;
  });
  return tokens.slice(0, 5).join(' ');
}

// Pulls a "use case" phrase out of the title - e.g. "under sink", "wall mount",
// "for cabinet". Lets demand find products that solve the same job even
// when the exact product is different.
const USE_CASE_PATTERNS: RegExp[] = [
  /\b(under\s+\w+)/i,
  /\b(over\s+the\s+\w+)/i,
  /\b(over\s+\w+)/i,
  /\b(wall\s+mount(?:ed)?)/i,
  /\b(for\s+\w+(?:\s+\w+)?)/i,
  /\b(\w+\s+organizer)/i,
  /\b(\w+\s+holder)/i,
  /\b(\w+\s+rack)/i,
  /\b(\w+\s+storage)/i,
];

function useCasePhrase(title: string): string {
  if (!title) return '';
  for (const re of USE_CASE_PATTERNS) {
    const m = title.match(re);
    if (m && m[1]) return m[1].toLowerCase().trim();
  }
  return '';
}

export function tokenize(s: string): string[] {
  return normalizeText(stripDiacritics(s))
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
