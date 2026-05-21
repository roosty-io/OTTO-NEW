import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/utils/logger';

/**
 * Convenience helper: prints the schema.sql file path so it can be applied
 * via the Supabase SQL editor, psql, or the Supabase CLI.  Schema execution
 * over the network requires a direct Postgres connection which we do not
 * currently configure - keep this manual on purpose.
 */
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const exists = fs.existsSync(schemaPath);
logger.info('OTTO schema is located at', { schemaPath, exists });
logger.info('Apply via: psql "$DATABASE_URL" -f src/db/schema.sql   (or paste into Supabase SQL editor)');
