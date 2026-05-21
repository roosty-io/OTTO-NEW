import { BLACKLIST_BRANDS, BLACKLIST_KEYWORDS, RESTRICTED_CATEGORIES } from '@/config/categories';
import { containsAny, detectMultipack } from '@/utils/normalize';
import { clamp } from '@/utils/scoring';
import { makeResult } from '@/agents/baseAgent';
import type { AgentResult } from '@/types/agent';

export interface ComplianceContext {
  ottoProductId: string;
  title: string;
  brand?: string;
  amazonCategory?: string;
  ebayCategoryHint?: string;
  variationAttributes?: Record<string, string>;
}

export type ComplianceAgentFn = (ctx: ComplianceContext) => AgentResult<{ hardReject: boolean }>;

function score(reasons: string[], hardReject: boolean, base = 0): number {
  if (hardReject) return 100;
  return clamp(base + reasons.length * 20);
}

function build(
  name: string,
  ctx: ComplianceContext,
  reasons: string[],
  hardReject: boolean,
  baseScore = 0,
): AgentResult<{ hardReject: boolean }> {
  const status = hardReject ? 'fail' : reasons.length > 0 ? 'warning' : 'pass';
  return makeResult(name, ctx.ottoProductId, status, score(reasons, hardReject, baseScore), reasons, { hardReject });
}

export const VeroBrandAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = ctx.brand ? containsAny(ctx.brand, BLACKLIST_BRANDS) : null;
  const titleHit = containsAny(ctx.title, BLACKLIST_BRANDS);
  if (hit) reasons.push(`Brand on VeRO list: ${hit}`);
  if (titleHit && !hit) reasons.push(`Title mentions VeRO brand: ${titleHit}`);
  return build('VeroBrandAgent', ctx, reasons, reasons.length > 0);
};

export const TrademarkKeywordAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['oem', 'authentic', 'genuine', 'official', 'licensed']);
  if (hit) reasons.push(`Trademark-risk keyword: ${hit}`);
  return build('TrademarkKeywordAgent', ctx, reasons, false, 20);
};

export const CopyrightCharacterAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const characters = [
    'mickey', 'minnie', 'mario', 'pokemon', 'pikachu', 'spider-man', 'spiderman',
    'batman', 'superman', 'frozen', 'elsa', 'star wars', 'harry potter', 'marvel',
    'disney', 'paw patrol', 'hello kitty',
  ];
  const hit = containsAny(ctx.title, characters);
  if (hit) reasons.push(`Copyrighted character: ${hit}`);
  return build('CopyrightCharacterAgent', ctx, reasons, reasons.length > 0);
};

export const CounterfeitReplicaAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['replica', 'copy', 'inspired by', 'style of', 'knockoff', 'fake']);
  if (hit) reasons.push(`Counterfeit-signal keyword: ${hit}`);
  return build('CounterfeitReplicaAgent', ctx, reasons, reasons.length > 0);
};

export const RestrictedCategoryAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const cats = RESTRICTED_CATEGORIES.map((c) => c.name);
  const amazonCat = ctx.amazonCategory ?? '';
  const ebayCat = ctx.ebayCategoryHint ?? '';
  const hit = containsAny(`${amazonCat} ${ebayCat}`, cats);
  if (hit) reasons.push(`Restricted category: ${hit}`);
  return build('RestrictedCategoryAgent', ctx, reasons, reasons.length > 0);
};

export const MedicalDeviceAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['thermometer', 'glucose', 'cpap', 'blood pressure', 'oximeter', 'stethoscope', 'medical grade']);
  if (hit) reasons.push(`Possible medical device: ${hit}`);
  return build('MedicalDeviceAgent', ctx, reasons, reasons.length > 0);
};

export const SupplementFoodAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['vitamin', 'supplement', 'protein powder', 'edible', 'candy', 'snack', 'tea', 'coffee', 'organic food']);
  if (hit) reasons.push(`Ingestible / supplement risk: ${hit}`);
  return build('SupplementFoodAgent', ctx, reasons, reasons.length > 0);
};

export const HazardousMaterialAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['flammable', 'aerosol', 'lithium battery', 'pesticide', 'bleach', 'acid', 'solvent', 'lighter fluid']);
  if (hit) reasons.push(`Hazmat keyword: ${hit}`);
  return build('HazardousMaterialAgent', ctx, reasons, reasons.length > 0);
};

export const WeaponSelfDefenseAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['knife', 'sword', 'pepper spray', 'taser', 'stun gun', 'firearm', 'gun', 'ammo', 'bullet', 'crossbow', 'machete']);
  if (hit) reasons.push(`Weapon/self-defense: ${hit}`);
  return build('WeaponSelfDefenseAgent', ctx, reasons, reasons.length > 0);
};

export const BabySafetyAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['car seat', 'baby crib', 'baby monitor', 'pacifier', 'baby formula', 'breast pump', 'bottle warmer']);
  if (hit) reasons.push(`Baby-safety category: ${hit}`);
  return build('BabySafetyAgent', ctx, reasons, reasons.length > 0);
};

export const ElectronicsBrandAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const brands = ['apple', 'samsung', 'sony', 'bose', 'beats', 'microsoft', 'nintendo', 'playstation', 'xbox', 'dell', 'hp ', 'lenovo'];
  const hit = containsAny(ctx.title, brands) || (ctx.brand ? containsAny(ctx.brand, brands) : null);
  if (hit) reasons.push(`Branded electronics: ${hit}`);
  return build('ElectronicsBrandAgent', ctx, reasons, reasons.length > 0);
};

export const LuxuryFashionAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const brands = ['louis vuitton', 'gucci', 'chanel', 'rolex', 'prada', 'coach', 'michael kors', 'burberry', 'dior', 'hermes', 'fendi'];
  const hit = containsAny(ctx.title, brands) || (ctx.brand ? containsAny(ctx.brand, brands) : null);
  if (hit) reasons.push(`Luxury / counterfeit-prone brand: ${hit}`);
  return build('LuxuryFashionAgent', ctx, reasons, reasons.length > 0);
};

export const CompatibilityFitmentAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const hit = containsAny(ctx.title, ['for ford', 'for toyota', 'for honda', 'for chevy', 'fits ', 'compatible with', 'replacement for']);
  if (hit) reasons.push(`Fitment-heavy compatibility: ${hit}`);
  return build('CompatibilityFitmentAgent', ctx, reasons, reasons.length > 0, 15);
};

export const BrandStrengthAgent: ComplianceAgentFn = (ctx) => {
  const reasons: string[] = [];
  const strongBrand = ctx.brand ? containsAny(ctx.brand, BLACKLIST_BRANDS) : null;
  if (strongBrand) reasons.push(`Strong protected brand: ${strongBrand}`);
  return build('BrandStrengthAgent', ctx, reasons, reasons.length > 0);
};

export const PolicyMemoryAgent: ComplianceAgentFn = (ctx) => {
  // V1 placeholder: PolicyMemoryAgent will look up prior rejection patterns
  // from `rejected_products` / `product_feedback`.  For now we softly flag
  // multipack / bundle title language which historically gets rejected.
  const reasons: string[] = [];
  if (detectMultipack(ctx.title)) reasons.push('Title contains pack/bundle language');
  if (containsAny(ctx.title, BLACKLIST_KEYWORDS)) reasons.push('Title hits blacklist keyword memory');
  return build('PolicyMemoryAgent', ctx, reasons, false, 10);
};

export const ALL_COMPLIANCE_AGENTS: { name: string; fn: ComplianceAgentFn }[] = [
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
