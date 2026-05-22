export function normalizeText(s: string | undefined | null): string {
  if (!s) return '';
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function tokenize(s: string): string[] {
  return normalizeText(stripDiacritics(s))
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function containsAny(haystack: string, needles: string[]): string | null {
  const hay = normalizeText(haystack);
  for (const n of needles) {
    const needle = normalizeText(n);
    if (needle && hay.includes(needle)) return n;
  }
  return null;
}

const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/;

export function extractAsin(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = s.match(ASIN_RE);
  return m ? m[1] : null;
}

export function amazonUrlFromAsin(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

const PACK_RE = /\b(\d+)\s*[- ]?\s*(packs?|pk|counts?|cts?|tiers?|pcs?)\b/i;

export function detectMultipack(title: string): boolean {
  if (!title) return false;
  if (PACK_RE.test(title)) return true;
  const lc = title.toLowerCase();
  return lc.includes('multipack') || lc.includes('multi-pack') || lc.includes('bundle') || lc.includes('lot of');
}

export function detectRenewed(title: string): boolean {
  const lc = (title || '').toLowerCase();
  return lc.includes('renewed') || lc.includes('refurbished') || lc.includes('open box') || lc.includes('pre-owned');
}

export function detectAmazonBasics(title: string, brand?: string): boolean {
  const lc = (title || '').toLowerCase();
  const br = (brand || '').toLowerCase();
  return lc.includes('amazon basics') || br === 'amazon basics' || br === 'amazonbasics';
}
