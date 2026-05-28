// Keepa category targeting for V1 discovery.  Pure helpers — no I/O —
// so they can be unit-tested directly.
//
// Root category ids are for amazon.com (Keepa domain=1).

export interface AllowedCategory {
  name: string;
  rootId: number;
}

// Safer V1 categories for Amazon-to-eBay dropshipping.  These map to
// Keepa/Amazon.com root category ids.
export const ALLOWED_V1_CATEGORIES: AllowedCategory[] = [
  { name: 'Home & Kitchen', rootId: 1055398 },
  { name: 'Tools & Home Improvement', rootId: 228013 },
  { name: 'Patio, Lawn & Garden', rootId: 2972638011 },
  { name: 'Office Products', rootId: 1064954 },
  { name: 'Arts, Crafts & Sewing', rootId: 2617941011 },
  { name: 'Pet Supplies', rootId: 2619533011 },
];

// Category / title fragments that disqualify a candidate regardless of
// root category (defense-in-depth on top of root-category targeting).
export const EXCLUDED_CATEGORY_PATTERNS: RegExp[] = [
  /health\s*&?\s*(personal\s*care|household|beauty)/i,
  /\bbeauty\b/i,
  /\bgrocery\b/i,
  /\b(food|snack|beverage|coffee|tea)\b/i,
  /\b(supplement|vitamin|nutrition|probiotic)\b/i,
  /\b(baby|infant|toddler|nursery)\b/i,
  /\b(medical|medicine|drug|pharmac|first\s*aid|therapeutic)\b/i,
  /\b(weapon|knife|firearm|ammo|tactical|self[-\s]?defense|pepper\s*spray)\b/i,
  /\b(luxury|designer|couture)\b/i,
  /\b(fashion|apparel|clothing|jewelry|watch(es)?|handbag)\b/i,
  /\belectronics?\b/i,
  /\b(automotive|motor\s*vehicle|car\s*part|fitment|tire)\b/i,
  /\b(toys?\s*&?\s*games?)\b/i,
  // Pet ingestibles / medical (Pet Supplies root is allowed, but not these)
  /\b(pet\s*(food|treat|supplement|medication|health|vitamin)|cat\s*food|dog\s*food|kibble)\b/i,
];

/** Resolve a CLI/env category selector to target root categories. */
export function resolveCategoryTargets(
  selector?: string,
  allowedCsvOverride?: string,
): AllowedCategory[] {
  const base = parseAllowedOverride(allowedCsvOverride) ?? ALLOWED_V1_CATEGORIES;
  if (!selector || selector.trim() === '' || selector.trim().toLowerCase() === 'all') {
    return base;
  }
  const sel = selector.trim();
  // numeric id?
  if (/^\d+$/.test(sel)) {
    const byId = base.find((c) => c.rootId === Number(sel));
    return byId ? [byId] : [{ name: `category_${sel}`, rootId: Number(sel) }];
  }
  // name match (case-insensitive, partial)
  const lc = sel.toLowerCase();
  const byName = base.filter((c) => c.name.toLowerCase().includes(lc));
  return byName.length > 0 ? byName : base;
}

function parseAllowedOverride(csv?: string): AllowedCategory[] | null {
  if (!csv || csv.trim() === '') return null;
  const out: AllowedCategory[] = [];
  for (const part of csv.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      out.push({ name: `category_${part}`, rootId: Number(part) });
    } else {
      const known = ALLOWED_V1_CATEGORIES.find((c) => c.name.toLowerCase() === part.toLowerCase());
      if (known) out.push(known);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Returns true when a category breadcrumb / title is allowed: it must NOT
 * match any excluded pattern.  Extra excluded patterns (from env) are
 * appended.
 */
export function isCategoryAllowed(
  categoryBreadcrumb: string | undefined,
  productTitle: string | undefined,
  extraExcludedCsv?: string,
): boolean {
  const haystack = `${categoryBreadcrumb ?? ''} ${productTitle ?? ''}`.trim();
  if (!haystack) return true; // nothing to judge on; let downstream gates decide
  for (const re of EXCLUDED_CATEGORY_PATTERNS) {
    if (re.test(haystack)) return false;
  }
  if (extraExcludedCsv) {
    for (const term of extraExcludedCsv.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (haystack.toLowerCase().includes(term.toLowerCase())) return false;
    }
  }
  return true;
}
