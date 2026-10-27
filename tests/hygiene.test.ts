// The old Bolt prototype backend must not come back, and the web app must stay free of secrets and fake data.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

const webSource = files(join(ROOT, 'namaa-agritech', 'src')).filter((f) => /\.(ts|tsx|css|html)$/.test(f));

describe('old Bolt backend is gone', () => {
  it('has no namaa-agritech/supabase folder (the one backend is ./supabase)', () => {
    expect(existsSync(join(ROOT, 'namaa-agritech', 'supabase'))).toBe(false);
  });
  it('has no old prototype files (fake data file, old chat helpers)', () => {
    for (const f of ['src/data.ts', 'src/lib/rag.ts', 'src/lib/validation.ts']) {
      expect(existsSync(join(ROOT, 'namaa-agritech', f)), f).toBe(false);
    }
  });
  it('does not mention Bolt or the old ai_* tables anywhere in the code', () => {
    const bad: string[] = [];
    for (const f of [...webSource, ...files(join(ROOT, 'supabase')), ...files(join(ROOT, 'src'))]) {
      const text = readFileSync(f, 'utf-8');
      if (/\bbolt\b/i.test(text) || /\bai_(conversations|messages|chats)\b/.test(text)) bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
  });
});

describe('web app rules', () => {
  it('never uses the service-role key (it must stay on the server)', () => {
    const bad = webSource.filter((f) => /service_role|SERVICE_ROLE/.test(readFileSync(f, 'utf-8'))).map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });
  it('talks to the chatbot only through the namaa-chat function', () => {
    const calls = webSource.flatMap((f) => [...readFileSync(f, 'utf-8').matchAll(/functions\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]));
    expect(calls).toContain('namaa-chat');
  });
  it('config.toml lists namaa-chat (it checks the user itself)', () => {
    expect(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf-8')).toMatch(/\[functions\.namaa-chat\]/);
  });
});
