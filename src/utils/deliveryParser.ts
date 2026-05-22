// Robust delivery-text parser for Amazon product detail pages.
//
// Common patterns we need to recognize:
//   "FREE delivery Tomorrow"
//   "FREE delivery Monday, May 25"
//   "Delivery Friday, May 29"
//   "Arrives May 28 - June 1"
//   "Usually ships within 2 to 3 days"
//   "Or fastest delivery Tomorrow"
//   "In Stock"
//   "Temporarily out of stock"
//   "Currently unavailable"
//
// We never auto-pass when delivery is unparseable. If the page doesn't
// surface a date or window, confidence is 'low' and the caller should
// only accept the product when stock / availability signals are strong.

export type DeliveryParseConfidence = 'high' | 'medium' | 'low' | 'none';

export interface DeliveryParseResult {
  rawText: string;
  estimatedDeliveryDays?: number;
  deliveryParseConfidence: DeliveryParseConfidence;
  deliveryWindowStart?: string; // ISO date (YYYY-MM-DD)
  deliveryWindowEnd?: string;
  deliveryPassesMaxWindow?: boolean;
  signals: string[];
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const OUT_OF_STOCK_PHRASES = [
  'currently unavailable',
  'temporarily out of stock',
  'out of stock',
  'unavailable',
];

export function parseDelivery(
  text: string | undefined | null,
  maxDeliveryDays: number,
  now: Date = new Date(),
): DeliveryParseResult {
  const raw = (text ?? '').trim();
  const lc = raw.toLowerCase();
  const signals: string[] = [];

  if (!raw) {
    return {
      rawText: '',
      deliveryParseConfidence: 'none',
      signals: ['empty_delivery_text'],
    };
  }

  if (OUT_OF_STOCK_PHRASES.some((p) => lc.includes(p))) {
    signals.push('out_of_stock_text');
    return {
      rawText: raw,
      deliveryParseConfidence: 'high',
      signals,
      deliveryPassesMaxWindow: false,
    };
  }

  // "Tomorrow" - highest confidence one-day delivery.
  if (/\btomorrow\b/i.test(raw)) {
    const days = 1;
    signals.push('tomorrow');
    const date = addDays(now, days);
    return {
      rawText: raw,
      estimatedDeliveryDays: days,
      deliveryParseConfidence: 'high',
      deliveryWindowStart: iso(date),
      deliveryWindowEnd: iso(date),
      deliveryPassesMaxWindow: days <= maxDeliveryDays,
      signals,
    };
  }

  // "Today" - same-day.
  if (/\btoday\b/i.test(raw)) {
    signals.push('today');
    return {
      rawText: raw,
      estimatedDeliveryDays: 0,
      deliveryParseConfidence: 'high',
      deliveryWindowStart: iso(now),
      deliveryWindowEnd: iso(now),
      deliveryPassesMaxWindow: 0 <= maxDeliveryDays,
      signals,
    };
  }

  // Date range: "May 28 - June 1" or "May 28-June 1".
  const range = matchDateRange(raw, now);
  if (range) {
    signals.push('date_range');
    const startDays = diffDays(now, range.start);
    const endDays = diffDays(now, range.end);
    const estimated = Math.max(endDays, startDays);
    return {
      rawText: raw,
      estimatedDeliveryDays: estimated,
      deliveryParseConfidence: 'high',
      deliveryWindowStart: iso(range.start),
      deliveryWindowEnd: iso(range.end),
      deliveryPassesMaxWindow: estimated <= maxDeliveryDays,
      signals,
    };
  }

  // Single date: "Monday, May 25" or "May 25"
  const single = matchSingleDate(raw, now);
  if (single) {
    signals.push('single_date');
    const days = diffDays(now, single);
    return {
      rawText: raw,
      estimatedDeliveryDays: days,
      deliveryParseConfidence: 'high',
      deliveryWindowStart: iso(single),
      deliveryWindowEnd: iso(single),
      deliveryPassesMaxWindow: days <= maxDeliveryDays,
      signals,
    };
  }

  // "Usually ships within X to Y days" / "Ships in X days".
  const shipWindow = matchShipsWithin(raw);
  if (shipWindow) {
    signals.push('ships_within');
    // Add a typical 2-day transit estimate to the high end of the ship window.
    const estimated = shipWindow.maxDays + 2;
    return {
      rawText: raw,
      estimatedDeliveryDays: estimated,
      deliveryParseConfidence: 'medium',
      deliveryWindowStart: iso(addDays(now, shipWindow.minDays)),
      deliveryWindowEnd: iso(addDays(now, estimated)),
      deliveryPassesMaxWindow: estimated <= maxDeliveryDays,
      signals,
    };
  }

  // "X day shipping" / "Delivered in X days" / "in 5 days".
  const inDays = raw.match(
    /\b(?:in|within|delivered in|delivery in|arrives in)\s+(\d{1,2})(?:\s*(?:to|-|–)\s*(\d{1,2}))?\s*(?:business\s+)?days?\b/i,
  );
  if (inDays) {
    const a = Number(inDays[1]);
    const b = inDays[2] ? Number(inDays[2]) : a;
    const estimated = Math.max(a, b);
    signals.push('in_days');
    return {
      rawText: raw,
      estimatedDeliveryDays: estimated,
      deliveryParseConfidence: 'medium',
      deliveryWindowStart: iso(addDays(now, Math.min(a, b))),
      deliveryWindowEnd: iso(addDays(now, estimated)),
      deliveryPassesMaxWindow: estimated <= maxDeliveryDays,
      signals,
    };
  }

  // "In Stock" alone is not a delivery promise.
  if (/\bin stock\b/i.test(lc)) signals.push('in_stock_only_text');

  return {
    rawText: raw,
    deliveryParseConfidence: 'low',
    signals,
  };
}

function matchDateRange(s: string, now: Date): { start: Date; end: Date } | null {
  // Examples:
  //   "Arrives May 28 - June 1"
  //   "May 28 to June 2"
  //   "May 28-30"
  const m = s.match(
    /([A-Za-z]{3,9})\s+(\d{1,2})\s*(?:-|–|to)\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2})/,
  );
  if (!m) return null;
  const monStart = MONTHS[m[1].toLowerCase()];
  const dayStart = Number(m[2]);
  const monEnd = m[3] ? MONTHS[m[3].toLowerCase()] : monStart;
  const dayEnd = Number(m[4]);
  if (monStart === undefined || monEnd === undefined) return null;
  const start = makeFutureDate(now, monStart, dayStart);
  const end = makeFutureDate(now, monEnd, dayEnd, start);
  return { start, end };
}

function matchSingleDate(s: string, now: Date): Date | null {
  // "Monday, May 25" or "May 25" or "May 25, 2026"
  const m = s.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*([A-Za-z]{3,9})\s+(\d{1,2})\b/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  if (mon === undefined) return null;
  return makeFutureDate(now, mon, day);
}

function matchShipsWithin(s: string): { minDays: number; maxDays: number } | null {
  const m = s.match(/ships?\s+(?:within|in)\s+(\d{1,2})(?:\s*(?:to|-|–)\s*(\d{1,2}))?\s*(?:business\s+)?days?/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { minDays: Math.min(a, b), maxDays: Math.max(a, b) };
}

function makeFutureDate(now: Date, month: number, day: number, mustBeAfter?: Date): Date {
  const year = now.getFullYear();
  const candidate = new Date(year, month, day);
  // If the date is in the past (or before mustBeAfter), assume next year.
  const ref = mustBeAfter ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (candidate.getTime() < ref.getTime()) {
    candidate.setFullYear(year + 1);
  }
  return candidate;
}

function diffDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + days);
  return c;
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
