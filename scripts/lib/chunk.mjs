// Splits a knowledge file into chunks for the vector store. Pure functions (tested).

/** { meta: {title, url, source_id}, body } from a markdown file with a small front matter block */
export function parseKnowledgeFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing front matter (--- title / url ---)');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  if (!meta.title) throw new Error('front matter needs a title');
  return { meta, body: m[2].trim() };
}

/** chunks of at most maxChars, cut at headings and paragraphs; each chunk starts with its heading so it makes sense alone */
export function chunkBody(body, maxChars = 900) {
  const sections = body.split(/\n(?=#{1,3} )/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  for (const section of sections) {
    const lines = section.split('\n');
    const heading = /^#{1,3} /.test(lines[0]) ? lines[0].replace(/^#+\s*/, '') : '';
    const paragraphs = (heading ? lines.slice(1) : lines).join('\n').split(/\n{2,}|\n(?=[-*] )/).map((p) => p.trim()).filter(Boolean);
    let current = '';
    const flush = () => {
      if (current.trim()) chunks.push((heading ? `${heading}\n` : '') + current.trim());
      current = '';
    };
    for (const p of paragraphs) {
      if (p.length > maxChars) {
        flush();
        for (const piece of p.split(/(?<=[.!?؟])\s+/)) {
          if ((current + ' ' + piece).length > maxChars) flush();
          current += (current ? ' ' : '') + piece;
        }
        flush();
      } else {
        if ((current + '\n' + p).length > maxChars) flush();
        current += (current ? '\n' : '') + p;
      }
    }
    flush();
  }
  return chunks;
}
