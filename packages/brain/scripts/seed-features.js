// packages/brain/scripts/seed-features.js
// 用法：node packages/brain/scripts/seed-features.js
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new Pool(DB_DEFAULTS);

const yamlPath = join(__dirname, '../../../docs/feature-ledger.yaml');
const raw = readFileSync(yamlPath, 'utf8');
const data = yaml.load(raw);

let inserted = 0;
let updated = 0;

for (const f of data.features) {
  const { rows } = await pool.query(
    `INSERT INTO features
       (id, name, domain, area, priority, status, description, smoke_cmd,
        has_unit_test, has_integration_test, has_e2e, last_verified, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       name                 = EXCLUDED.name,
       domain               = EXCLUDED.domain,
       area                 = EXCLUDED.area,
       priority             = EXCLUDED.priority,
       status               = EXCLUDED.status,
       description          = EXCLUDED.description,
       smoke_cmd            = EXCLUDED.smoke_cmd,
       has_unit_test        = EXCLUDED.has_unit_test,
       has_integration_test = EXCLUDED.has_integration_test,
       has_e2e              = EXCLUDED.has_e2e,
       last_verified        = EXCLUDED.last_verified,
       notes                = EXCLUDED.notes,
       updated_at           = NOW()
     RETURNING (xmax = 0) AS is_insert`,
    [f.id, f.name, f.domain ?? null, f.area ?? null, f.priority ?? null,
     f.status ?? 'unknown', f.description ?? null, f.smoke_cmd ?? null,
     f.has_unit_test ?? false, f.has_integration_test ?? false,
     f.has_e2e ?? false, f.last_verified ?? null, f.notes ?? null]
  );
  if (rows[0]?.is_insert) inserted++;
  else updated++;
}

console.log(`✅ Seed 完成: ${inserted} inserted, ${updated} updated, ${data.features.length} total`);
await pool.end();
