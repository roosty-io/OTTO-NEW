/* eslint-disable no-console */
/**
 * test-compliance.ts
 *
 * Drives ComplianceRiskCouncil against a fixed set of safe and risky
 * product profiles to verify the hardened agents catch obvious risk
 * without falsely rejecting normal organizers.
 *
 * Usage:
 *   npm run test:compliance
 */

import { v4 as uuidv4 } from 'uuid';
import { ComplianceRiskCouncil } from '@/agents/compliance/ComplianceRiskCouncil';
import type { ComplianceContext } from '@/agents/compliance/ComplianceRiskCouncil';

interface Sample {
  label: string;
  title: string;
  brand?: string;
  bullets?: string[];
  amazonCategoryBreadcrumbs?: string[];
  coreKeyword?: string;
  expect: 'pass' | 'fail' | 'manual_review';
}

const SAFE_SAMPLES: Sample[] = [
  {
    label: 'safe: under sink organizer',
    title: '2 Tier Under Sink Organizer Pull Out Cabinet Storage Sliding Drawer',
    brand: 'OttoOrganize',
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage & Organization', 'Cabinet Organizers'],
    coreKeyword: 'under sink organizer',
    expect: 'pass',
  },
  {
    label: 'safe: garage storage rack',
    title: 'Heavy Duty Garage Storage Rack Wall Mounted Shelf 3 Tier',
    brand: 'GarageMax',
    amazonCategoryBreadcrumbs: ['Tools & Home Improvement', 'Garage Storage'],
    coreKeyword: 'garage storage rack',
    expect: 'pass',
  },
  {
    label: 'safe: desk cable organizer tray',
    title: 'Under Desk Cable Management Tray No Drill Cord Organizer',
    brand: 'CableNeat',
    amazonCategoryBreadcrumbs: ['Office Products', 'Office Furniture'],
    coreKeyword: 'desk cable organizer',
    expect: 'pass',
  },
  {
    label: 'safe: garden kneeling pad',
    title: 'Garden Kneeling Pad with Handles Thick Foam Cushion',
    brand: 'GardenPro',
    amazonCategoryBreadcrumbs: ['Patio, Lawn & Garden'],
    coreKeyword: 'garden kneeling pad',
    expect: 'pass',
  },
  {
    label: 'safe: craft storage box',
    title: '3 Layer Plastic Craft Storage Box Organizer with Adjustable Spacers',
    brand: 'BTSKY',
    amazonCategoryBreadcrumbs: ['Arts, Crafts & Sewing', 'Storage'],
    coreKeyword: 'craft storage box',
    expect: 'pass',
  },
];

const RISKY_SAMPLES: Sample[] = [
  {
    label: 'risky: Disney princess storage bin',
    title: 'Disney Princess Storage Bin Kids Toy Box Frozen Elsa Anna',
    brand: 'Disney',
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage'],
    coreKeyword: 'disney princess storage bin',
    expect: 'fail',
  },
  {
    label: 'risky: Apple iPhone MagSafe charger',
    title: 'Wireless Charger Compatible with iPhone 15 MagSafe Apple AirPods',
    brand: 'TechAccessory',
    amazonCategoryBreadcrumbs: ['Electronics', 'Cell Phone Accessories'],
    coreKeyword: 'iphone magsafe charger',
    expect: 'fail',
  },
  {
    label: 'risky: Nike shoe organizer',
    title: 'Nike Air Jordan Shoe Storage Organizer Box Display Case',
    brand: 'Nike',
    amazonCategoryBreadcrumbs: ['Home & Kitchen', 'Storage'],
    coreKeyword: 'nike shoe organizer',
    expect: 'fail',
  },
  {
    label: 'risky: LEGO storage case',
    title: 'LEGO Storage Brick Case Organizer for Minifigures',
    brand: 'LEGO',
    amazonCategoryBreadcrumbs: ['Toys & Games'],
    coreKeyword: 'lego storage case',
    expect: 'fail',
  },
  {
    label: 'risky: medical grade knee brace',
    title: 'Medical Grade Knee Brace FDA Approved Compression Support',
    brand: 'OrthoMed',
    amazonCategoryBreadcrumbs: ['Health & Household', 'Medical Supplies'],
    coreKeyword: 'medical grade knee brace',
    expect: 'fail',
  },
  {
    label: 'risky: tactical self defense flashlight',
    title: 'Tactical Self Defense LED Flashlight Stun Gun Pepper Spray Holster',
    brand: 'TacticalGear',
    amazonCategoryBreadcrumbs: ['Sports & Outdoors', 'Hunting'],
    coreKeyword: 'tactical flashlight',
    expect: 'fail',
  },
  {
    label: 'risky: baby car seat cover',
    title: 'Baby Car Seat Cover Universal Fit Infant Crib Safety',
    brand: 'BabyShield',
    amazonCategoryBreadcrumbs: ['Baby Products', 'Car Seats'],
    coreKeyword: 'baby car seat cover',
    expect: 'fail',
  },
  {
    label: 'risky: Gucci inspired handbag organizer',
    title: 'Handbag Organizer Insert Inspired by Gucci Marmont Luxury Purse',
    brand: 'LuxOrg',
    amazonCategoryBreadcrumbs: ['Clothing, Shoes & Jewelry', 'Handbags'],
    coreKeyword: 'gucci handbag organizer',
    expect: 'fail',
  },
  {
    label: 'risky: Pokemon party supplies',
    title: 'Pokemon Pikachu Birthday Party Supplies Decorations Plates Cups',
    brand: 'PartyPro',
    amazonCategoryBreadcrumbs: ['Toys & Games', 'Party Supplies'],
    coreKeyword: 'pokemon party supplies',
    expect: 'fail',
  },
  {
    label: 'risky: pesticide chemical sprayer',
    title: 'Pesticide Chemical Sprayer Bottle Insecticide Garden Spray',
    brand: 'GardenChem',
    amazonCategoryBreadcrumbs: ['Patio, Lawn & Garden', 'Pest Control'],
    coreKeyword: 'pesticide sprayer',
    expect: 'fail',
  },
];

async function runOne(council: ComplianceRiskCouncil, sample: Sample): Promise<{ sample: Sample; passed: boolean; manual: boolean; risk: number; reasons: string[]; matchedBrands: string[]; matchedKeywords: string[]; triggered: string[] }> {
  const ctx: ComplianceContext = {
    ottoProductId: `OTTO-TEST-${uuidv4()}`,
    title: sample.title,
    brand: sample.brand,
    bullets: sample.bullets,
    amazonCategoryBreadcrumbs: sample.amazonCategoryBreadcrumbs,
    coreKeyword: sample.coreKeyword,
  };
  const result = await council.run({ ctx });
  return {
    sample,
    passed: result.data.compliancePassed,
    manual: result.data.manualReview,
    risk: result.data.policyRiskScore,
    reasons: result.data.reasonCodes,
    matchedBrands: result.data.matchedBrands,
    matchedKeywords: result.data.matchedKeywords,
    triggered: result.data.triggeredAgents,
  };
}

function describeOutcome(o: { passed: boolean; manual: boolean }): 'pass' | 'fail' | 'manual_review' {
  if (o.passed) return 'pass';
  if (o.manual) return 'manual_review';
  return 'fail';
}

async function main(): Promise<void> {
  const council = new ComplianceRiskCouncil();
  const all = [...SAFE_SAMPLES, ...RISKY_SAMPLES];

  let okCount = 0;
  const rows: Array<Awaited<ReturnType<typeof runOne>>> = [];
  for (const s of all) rows.push(await runOne(council, s));

  for (const r of rows) {
    const outcome = describeOutcome(r);
    const ok = matchesExpect(r.sample.expect, outcome);
    if (ok) okCount++;
    console.log('\n--------------------------------------------------------');
    console.log(`product title    : ${r.sample.title}`);
    console.log(`brand            : ${r.sample.brand ?? '(none)'}`);
    console.log(`expected         : ${r.sample.expect}`);
    console.log(`outcome          : ${outcome}${ok ? '  OK' : '  MISMATCH'}`);
    console.log(`policy risk      : ${r.risk.toFixed(0)}`);
    console.log(`hard block       : ${!r.passed && !r.manual}`);
    console.log(`manual review    : ${r.manual}`);
    console.log(`compliance passed: ${r.passed}`);
    console.log(`matched brands   : ${r.matchedBrands.join(', ') || '(none)'}`);
    console.log(`matched keywords : ${r.matchedKeywords.join(', ') || '(none)'}`);
    console.log(`triggered agents : ${r.triggered.join(', ') || '(none)'}`);
    console.log(`reason codes     : ${r.reasons.join(', ') || '(none)'}`);
  }

  console.log('\n========== TEST COMPLIANCE SUMMARY ==========');
  console.log(`  ${okCount}/${rows.length} samples matched the expected outcome`);
  for (const r of rows) {
    const outcome = describeOutcome(r);
    const ok = matchesExpect(r.sample.expect, outcome);
    console.log(`    ${ok ? 'OK  ' : 'BAD '}${outcome.padEnd(13)}  expected=${r.sample.expect.padEnd(13)}  ${r.sample.label}`);
  }
  console.log('==============================================\n');
}

function matchesExpect(expected: Sample['expect'], actual: 'pass' | 'fail' | 'manual_review'): boolean {
  if (expected === actual) return true;
  // We treat manual_review as acceptable when the test expects 'fail' (both
  // outcomes mean "does not advance to final validation").
  if (expected === 'fail' && actual === 'manual_review') return true;
  return false;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('test-compliance failed', err);
  process.exit(1);
});
