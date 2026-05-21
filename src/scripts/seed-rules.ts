import { seedRules } from '@/db/seed';
import { logger } from '@/utils/logger';

(async () => {
  try {
    await seedRules();
  } catch (err) {
    logger.error('Seeding failed', { err: (err as Error).message });
    process.exit(1);
  }
})();
