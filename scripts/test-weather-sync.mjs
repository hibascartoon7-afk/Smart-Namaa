// Calls the deployed weather-sync function as a real signed-in user, then reads back what was stored.
// Usage (PowerShell, from the project root):
//   node --env-file=.env scripts/test-weather-sync.mjs <field_id>
// .env (never commit it; .gitignore already ignores it):
//   SUPABASE_URL=https://<project-ref>.supabase.co
//   SUPABASE_ANON_KEY=<anon / publishable key from Project Settings -> API>
//   TEST_EMAIL=<email of the test user>
//   TEST_PASSWORD=<password of the test user>
import { createClient } from '@supabase/supabase-js';

const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TEST_EMAIL', 'TEST_PASSWORD'];
const missing = need.filter((k) => !process.env[k]);
const fieldId = process.argv[2];
if (missing.length || !fieldId) {
  console.error(`Missing: ${[...missing, ...(fieldId ? [] : ['<field_id> argument'])].join(', ')}`);
  console.error('Usage: node --env-file=.env scripts/test-weather-sync.mjs <field_id>');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const signIn = await supabase.auth.signInWithPassword({
  email: process.env.TEST_EMAIL,
  password: process.env.TEST_PASSWORD,
});
if (signIn.error) {
  console.error('Sign-in failed:', signIn.error.message);
  process.exit(1);
}
console.log('Signed in as the test user.');

const { data, error } = await supabase.functions.invoke('weather-sync', { body: { field_id: fieldId } });
if (error) {
  let detail = error.message;
  try {
    detail = JSON.stringify(await error.context.json());
  } catch {
    /* keep the generic message */
  }
  console.error('weather-sync failed:', detail);
  process.exit(1);
}
console.log('weather-sync answered:', data);

const q = await supabase
  .from('weather_observations')
  .select('observed_at, air_temperature_c, precipitation_mm, rain_probability_pct, et0_mm')
  .eq('field_id', fieldId)
  .order('observed_at', { ascending: true });
if (q.error) {
  console.error('Reading back failed:', q.error.message);
  process.exit(1);
}
const rows = q.data;
console.log(`Stored rows visible to this user: ${rows.length}`);
const nulls = (k) => rows.filter((r) => r[k] === null).length;
console.log('NULL counts (NULL = the API gave nothing):', {
  air_temperature_c: nulls('air_temperature_c'),
  precipitation_mm: nulls('precipitation_mm'),
  rain_probability_pct: nulls('rain_probability_pct'),
  et0_mm: nulls('et0_mm'),
});
console.table(rows.slice(0, 5));
