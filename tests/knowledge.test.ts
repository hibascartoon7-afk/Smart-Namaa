import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { chunkBody, parseKnowledgeFile } from '../scripts/lib/chunk.mjs';

describe('knowledge files', () => {
  const dir = new URL('../knowledge/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  it('there are files to ingest', () => expect(files.length).toBeGreaterThanOrEqual(3));
  for (const f of files) {
    it(`${f}: has a title, a real link when it quotes an outside source, and every chunk fits the limit`, () => {
      const { meta, body } = parseKnowledgeFile(readFileSync(new URL(f, dir), 'utf-8'));
      expect(meta.title.length).toBeGreaterThan(5);
      if (meta.url) expect(meta.url).toMatch(/^https?:\/\//); // outside sources must carry their link; the NAMAA how-it-works note has none
      const chunks = chunkBody(body);
      expect(chunks.length).toBeGreaterThan(0);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    });
  }
  it('rejects a file without front matter', () => {
    expect(() => parseKnowledgeFile('no header')).toThrow();
  });
  it('splits long text at sentences and keeps the heading on every chunk', () => {
    const long = '## Heading\n' + Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says something useful.`).join(' ');
    const chunks = chunkBody(long, 200);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.startsWith('Heading\n')).toBe(true);
      expect(c.length).toBeLessThanOrEqual(220);
    }
  });
});
