// Ghaith / Nada. The model only phrases the answer:
//   field numbers and decisions  -> read from what the decision engine stored (loadChatFacts)
//   general farming questions    -> reference text found by vector search (RAG, table knowledge_chunks)
// Secrets needed: OPENAI_API_KEY (optional: OPENAI_CHAT_MODEL, OPENAI_EMBEDDING_MODEL).
import { buildSystemPrompt, detectLanguage, sourcesOf, validateChatRequest, type KnowledgeChunk } from '../_shared/engine/chat.ts';
import { loadChatFacts } from '../_shared/engine/chat-context.ts';
import { adminClient, json, ownsField, preflight, readJson, SupabaseDb, userOf } from '../_shared/http.ts';

const CHAT_MODEL = Deno.env.get('OPENAI_CHAT_MODEL') ?? 'gpt-4o';
const EMBEDDING_MODEL = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small'; // 1536 numbers, as in the table

async function embed(text: string, apiKey: string): Promise<number[] | null> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json(503, { error: 'the chatbot is not configured yet (OPENAI_API_KEY is missing)' });

  const checked = validateChatRequest(await readJson(req, 32_000));
  if (!checked.ok) return json(400, { error: checked.error });
  const { persona, fieldId, messages } = checked.value;

  try {
    const admin = adminClient();
    const user = await userOf(req, admin);
    if (!user) return json(401, { error: 'sign in first' });
    if (!(await ownsField(admin, user.id, fieldId))) return json(404, { error: 'environment not found' });

    const question = messages[messages.length - 1].content;
    const language = detectLanguage(question);

    const facts = await loadChatFacts(new SupabaseDb(admin), fieldId, Date.now());
    if (!facts) return json(404, { error: 'environment not found' });

    // RAG: nearest reference chunks (none found = the model must say it cannot confirm)
    let chunks: KnowledgeChunk[] = [];
    const vector = await embed(question, apiKey);
    if (vector) {
      const { data } = await admin.rpc('match_knowledge', { query_embedding: vector, match_count: 4, min_similarity: 0.2 });
      chunks = (data ?? []).map((r: { title: string; url: string | null; content: string; similarity: number }) => ({ title: r.title, url: r.url, content: r.content, similarity: r.similarity }));
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        max_tokens: 600,
        messages: [{ role: 'system', content: buildSystemPrompt(persona, language, facts, chunks) }, ...messages],
      }),
    });
    if (!res.ok) {
      console.error('openai error', res.status, await res.text());
      return json(502, { error: 'the language model is not available right now' });
    }
    const data = await res.json();
    const reply: string | undefined = data?.choices?.[0]?.message?.content;
    if (!reply) return json(502, { error: 'the language model returned no answer' });

    return json(200, { reply, sources: sourcesOf(chunks), decision_at: facts.decision?.generated_at ?? null });
  } catch (e) {
    console.error('namaa-chat failed', e);
    return json(500, { error: 'the chat failed; see the function logs' });
  }
});
