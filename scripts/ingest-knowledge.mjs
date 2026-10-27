// Reads knowledge/*.md, embeds each chunk with OpenAI and stores it in public.knowledge_chunks.
//   npm run ingest-knowledge            needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY in the environment
//   npm run ingest-knowledge -- --dry   only shows what would be stored (no network)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkBody, parseKnowledgeFile } from './lib/chunk.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const dry = process.argv.includes('--dry');
const MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small'; // must stay 1536 numbers (table column)

const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
const docs = files.map((f) => {
  const { meta, body } = parseKnowledgeFile(readFileSync(join(DIR, f), 'utf-8'));
  return { file: f, meta, chunks: chunkBody(body) };
});

if (dry) {
  for (const d of docs) console.log(`${d.file}: ${d.chunks.length} chunks - ${d.meta.title}`);
  process.exit(0);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY first.');
  process.exit(1);
}
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function embed(inputs) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  return (await res.json()).data.map((d) => d.embedding);
}

for (const d of docs) {
  const vectors = await embed(d.chunks);
  const del = await db.from('knowledge_chunks').delete().eq('title', d.meta.title);
  if (del.error) throw del.error;
  const rows = d.chunks.map((content, i) => ({
    source_id: d.meta.source_id ?? null, title: d.meta.title, url: d.meta.url ?? null, content, embedding: vectors[i],
  }));
  const ins = await db.from('knowledge_chunks').insert(rows);
  if (ins.error) throw ins.error;
  console.log(`${d.file}: ${rows.length} chunks stored`);
}
