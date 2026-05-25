// Allow / restrict lists for V1.  These also seed the corresponding tables.

export const ALLOWED_CATEGORIES: { name: string; notes?: string }[] = [
  { name: 'Home & Kitchen' },
  { name: 'Storage & Organization' },
  { name: 'Patio, Lawn & Garden' },
  { name: 'Tools & Home Improvement' },
  { name: 'Office Products' },
  { name: 'Pet Supplies', notes: 'Exclude ingestibles, medical, supplements, flea/tick products' },
  { name: 'Arts, Crafts & Sewing' },
  { name: 'Sporting Goods', notes: 'Exclude weapons / safety gear' },
  { name: 'Party Supplies', notes: 'Exclude copyrighted characters' },
  { name: 'Home Décor' },
  { name: 'Cleaning Tools', notes: 'Exclude chemicals' },
  { name: 'Garage Organization' },
  { name: 'Kitchen Organization' },
  { name: 'Craft Storage' },
];

export const RESTRICTED_CATEGORIES: { name: string; reason: string; hardBlock: boolean }[] = [
  { name: 'Health & Beauty', reason: 'Compliance / IP risk', hardBlock: true },
  { name: 'Medical Devices', reason: 'FDA / eBay restricted', hardBlock: true },
  { name: 'Supplements', reason: 'FDA / eBay restricted', hardBlock: true },
  { name: 'Food / Grocery', reason: 'Perishable / FDA', hardBlock: true },
  { name: 'Cosmetics', reason: 'FDA / IP risk', hardBlock: true },
  { name: 'Baby Safety Products', reason: 'Safety / liability', hardBlock: true },
  { name: 'Car Seats', reason: 'Safety / liability', hardBlock: true },
  { name: 'Weapons', reason: 'eBay restricted', hardBlock: true },
  { name: 'Firearms', reason: 'eBay restricted', hardBlock: true },
  { name: 'Self-Defense Products', reason: 'eBay restricted', hardBlock: true },
  { name: 'Hazardous Materials', reason: 'Shipping restricted', hardBlock: true },
  { name: 'Pesticides', reason: 'EPA / shipping restricted', hardBlock: true },
  { name: 'Chemicals', reason: 'Shipping restricted', hardBlock: true },
  { name: 'Luxury Brands', reason: 'VeRO / counterfeit risk', hardBlock: true },
  { name: 'Fashion (counterfeit-prone)', reason: 'VeRO / IP risk', hardBlock: true },
  { name: 'Branded Electronics Accessories', reason: 'IP / authenticity risk', hardBlock: true },
  { name: 'Software / Digital Goods', reason: 'Licensing / eBay rules', hardBlock: true },
  { name: 'Trading Cards / Collectibles', reason: 'Authentication risk', hardBlock: true },
  { name: 'Fitment-Heavy Automotive Parts', reason: 'Returns / compatibility', hardBlock: true },
];

// Brand blacklist: VeRO-protected, high-risk-of-takedown, or known
// counterfeit magnets. Brands can carry aliases to handle Pokemon vs
// Pokémon, "Amazon Basics" vs "AmazonBasics", etc.
export interface BrandEntry {
  brand: string;
  aliases?: string[];
  category?: 'vero' | 'electronics' | 'luxury' | 'copyright' | 'sport_league' | 'home_brand' | 'general';
  hardBlock?: boolean;
}

export const BRAND_ENTRIES: BrandEntry[] = [
  // Electronics
  { brand: 'Apple', category: 'electronics', hardBlock: true },
  { brand: 'iPhone', category: 'electronics', hardBlock: true },
  { brand: 'iPad', category: 'electronics', hardBlock: true },
  { brand: 'AirPods', category: 'electronics', hardBlock: true },
  { brand: 'MagSafe', category: 'electronics', hardBlock: true },
  { brand: 'AppleCare', category: 'electronics', hardBlock: true },
  { brand: 'Samsung', category: 'electronics', hardBlock: true },
  { brand: 'Sony', category: 'electronics', hardBlock: true },
  { brand: 'Microsoft', category: 'electronics', hardBlock: true },
  { brand: 'Nintendo', category: 'electronics', hardBlock: true },
  { brand: 'PlayStation', aliases: ['Play Station', 'PS5', 'PS4'], category: 'electronics', hardBlock: true },
  { brand: 'Xbox', aliases: ['X-Box'], category: 'electronics', hardBlock: true },
  { brand: 'Bose', category: 'electronics', hardBlock: true },
  { brand: 'Beats', aliases: ['Beats by Dre', 'Beats by Dr Dre'], category: 'electronics', hardBlock: true },
  { brand: 'Dell', category: 'electronics', hardBlock: true },
  { brand: 'Lenovo', category: 'electronics', hardBlock: true },
  { brand: 'Asus', category: 'electronics', hardBlock: true },
  // Luxury / fashion
  { brand: 'Louis Vuitton', aliases: ['LV'], category: 'luxury', hardBlock: true },
  { brand: 'Gucci', category: 'luxury', hardBlock: true },
  { brand: 'Chanel', category: 'luxury', hardBlock: true },
  { brand: 'Rolex', category: 'luxury', hardBlock: true },
  { brand: 'Prada', category: 'luxury', hardBlock: true },
  { brand: 'Hermes', aliases: ['Hermès'], category: 'luxury', hardBlock: true },
  { brand: 'Dior', category: 'luxury', hardBlock: true },
  { brand: 'Fendi', category: 'luxury', hardBlock: true },
  { brand: 'Burberry', category: 'luxury', hardBlock: true },
  { brand: 'Coach', category: 'luxury', hardBlock: true },
  { brand: 'Michael Kors', category: 'luxury', hardBlock: true },
  { brand: 'Versace', category: 'luxury', hardBlock: true },
  { brand: 'Balenciaga', category: 'luxury', hardBlock: true },
  // Athletic / apparel
  { brand: 'Nike', category: 'vero', hardBlock: true },
  { brand: 'Adidas', category: 'vero', hardBlock: true },
  { brand: 'Lululemon', category: 'vero', hardBlock: true },
  { brand: 'Under Armour', category: 'vero', hardBlock: true },
  { brand: 'Puma', category: 'vero', hardBlock: true },
  { brand: 'New Balance', category: 'vero', hardBlock: true },
  // Copyrighted characters / IP
  { brand: 'Disney', category: 'copyright', hardBlock: true },
  { brand: 'Marvel', category: 'copyright', hardBlock: true },
  { brand: 'Pixar', category: 'copyright', hardBlock: true },
  { brand: 'Star Wars', category: 'copyright', hardBlock: true },
  { brand: 'Harry Potter', category: 'copyright', hardBlock: true },
  { brand: 'Pokemon', aliases: ['Pokémon', 'Pokémon TCG', 'Pokemon TCG'], category: 'copyright', hardBlock: true },
  { brand: 'Hello Kitty', aliases: ['Sanrio'], category: 'copyright', hardBlock: true },
  { brand: 'Barbie', category: 'copyright', hardBlock: true },
  { brand: 'Paw Patrol', category: 'copyright', hardBlock: true },
  { brand: 'Mickey Mouse', category: 'copyright', hardBlock: true },
  { brand: 'Minnie Mouse', category: 'copyright', hardBlock: true },
  { brand: 'Frozen', aliases: ['Elsa', 'Anna and Elsa'], category: 'copyright', hardBlock: true },
  { brand: 'Squishmallow', aliases: ['Squishmallows'], category: 'copyright', hardBlock: true },
  { brand: 'Spider-Man', aliases: ['Spiderman', 'Spider Man'], category: 'copyright', hardBlock: true },
  { brand: 'Batman', category: 'copyright', hardBlock: true },
  { brand: 'Superman', category: 'copyright', hardBlock: true },
  { brand: 'LEGO', aliases: ['Lego'], category: 'copyright', hardBlock: true },
  // Sports leagues / teams (often VeRO via licensors)
  { brand: 'NFL', category: 'sport_league', hardBlock: true },
  { brand: 'NBA', category: 'sport_league', hardBlock: true },
  { brand: 'MLB', category: 'sport_league', hardBlock: true },
  { brand: 'NHL', category: 'sport_league', hardBlock: true },
  { brand: 'NCAA', category: 'sport_league', hardBlock: true },
  // Brand-strong home / consumer goods
  { brand: 'Yeti', category: 'home_brand', hardBlock: true },
  { brand: 'Stanley', aliases: ['Stanley Quencher', 'Stanley Cup tumbler'], category: 'home_brand', hardBlock: true },
  { brand: 'Hydro Flask', category: 'home_brand', hardBlock: true },
  { brand: 'Owala', category: 'home_brand', hardBlock: true },
  { brand: 'Tupperware', category: 'home_brand', hardBlock: true },
  // Added after manual QA feedback (limit=25 review flagged Fiskars as
  // brand caution / VeRO risk).  Treated as hard block to keep V1 safe;
  // can be relaxed to manual_review later if appropriate.
  { brand: 'Fiskars', category: 'vero', hardBlock: true },
  // Self-source brand
  { brand: 'Amazon Basics', aliases: ['AmazonBasics'], category: 'general', hardBlock: true },
];

export const BLACKLIST_BRANDS: string[] = Array.from(
  new Set(
    BRAND_ENTRIES.flatMap((b) => [b.brand, ...(b.aliases ?? [])]),
  ),
);

// ---------------------------------------------------------------------------
// High-risk phrase lists
// ---------------------------------------------------------------------------
// Phrases that strongly imply counterfeit / IP / restricted-category risk.

export interface BlacklistPhrase {
  phrase: string;
  category: 'counterfeit' | 'trademark' | 'medical' | 'food_supplement' | 'hazmat'
    | 'weapon' | 'baby_safety' | 'compatibility' | 'copyright_character'
    | 'fitment' | 'general';
  /**
   * Where the phrase is allowed to fire from.
   *   'all'   = title + bullets + description + comparable titles
   *   'title' = title + warning badges only (use for noisy single words that
   *             appear in benign bullets as a use-case mention)
   */
  scope?: 'all' | 'title';
}

export const BLACKLIST_PHRASES: BlacklistPhrase[] = [
  // Counterfeit / replica
  { phrase: 'replica', category: 'counterfeit' },
  { phrase: 'fake', category: 'counterfeit' },
  { phrase: 'dupe', category: 'counterfeit' },
  { phrase: 'knockoff', category: 'counterfeit' },
  { phrase: 'inspired by', category: 'counterfeit' },
  // Trademark hedges
  { phrase: 'oem', category: 'trademark' },
  { phrase: 'authentic', category: 'trademark' },
  { phrase: 'licensed', category: 'trademark' },
  { phrase: 'official', category: 'trademark' },
  { phrase: 'trademark', category: 'trademark' },
  { phrase: 'copyright', category: 'trademark' },
  { phrase: 'genuine', category: 'trademark' },
  // Compatibility / fitment - context-aware
  { phrase: 'compatible with', category: 'compatibility' },
  { phrase: 'replacement for', category: 'compatibility' },
  { phrase: 'works with', category: 'compatibility' },
  { phrase: 'fits ', category: 'compatibility' },
  // Medical
  { phrase: 'medical grade', category: 'medical' },
  { phrase: 'fda approved', category: 'medical' },
  { phrase: 'fda cleared', category: 'medical' },
  { phrase: 'prescription', category: 'medical' },
  { phrase: 'pharmaceutical', category: 'medical' },
  { phrase: 'glucose meter', category: 'medical' },
  { phrase: 'cpap', category: 'medical' },
  { phrase: 'oximeter', category: 'medical' },
  { phrase: 'nebulizer', category: 'medical' },
  // Food / supplement
  { phrase: 'dietary supplement', category: 'food_supplement' },
  { phrase: 'supplement', category: 'food_supplement', scope: 'title' },
  { phrase: 'vitamin ', category: 'food_supplement', scope: 'title' },
  { phrase: 'edible', category: 'food_supplement' },
  { phrase: 'protein powder', category: 'food_supplement' },
  // Hazmat
  { phrase: 'pesticide', category: 'hazmat' },
  { phrase: 'insecticide', category: 'hazmat' },
  { phrase: 'flammable', category: 'hazmat' },
  { phrase: 'hazardous', category: 'hazmat' },
  { phrase: 'hazmat', category: 'hazmat' },
  { phrase: 'lithium battery', category: 'hazmat' },
  { phrase: 'aerosol', category: 'hazmat', scope: 'title' },
  // Weapons / self-defense  (multi-word phrases self-contextualize)
  { phrase: 'tactical', category: 'weapon' },
  { phrase: 'self defense', category: 'weapon' },
  { phrase: 'self-defense', category: 'weapon' },
  { phrase: 'pepper spray', category: 'weapon' },
  { phrase: 'firearm', category: 'weapon' },
  { phrase: 'stun gun', category: 'weapon' },
  { phrase: 'taser', category: 'weapon' },
  { phrase: 'switchblade', category: 'weapon' },
  { phrase: 'hunting knife', category: 'weapon' },
  { phrase: 'tactical knife', category: 'weapon' },
  // Baby safety
  { phrase: 'baby car seat', category: 'baby_safety' },
  { phrase: 'car seat', category: 'baby_safety' },
  { phrase: 'baby crib', category: 'baby_safety' },
  { phrase: 'crib mattress', category: 'baby_safety' },
];

export const BLACKLIST_KEYWORDS: string[] = Array.from(
  new Set(BLACKLIST_PHRASES.map((p) => p.phrase)),
);
