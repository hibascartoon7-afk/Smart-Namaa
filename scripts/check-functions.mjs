// Type-checks the Edge Functions with Deno (needs Deno installed: https://deno.com). Run: npm run check-functions
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// jsr.io is replaced by the npm copy of the same library only for this local check
const map = join(tmpdir(), 'namaa-deno-check.json');
writeFileSync(map, JSON.stringify({ imports: { 'jsr:@supabase/supabase-js@2': 'npm:@supabase/supabase-js@2' } }));
for (const fn of ['decision-engine', 'sensor-ingest', 'device-provision', 'namaa-chat', 'scheduled-refresh']) {
  console.log(`checking ${fn}`);
  execFileSync('deno', ['check', `--import-map=${map}`, `supabase/functions/${fn}/index.ts`], { stdio: 'inherit' });
}
console.log('all functions type-check');
