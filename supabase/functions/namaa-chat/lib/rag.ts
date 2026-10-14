import { supabase } from "./supabase.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export interface KnowledgeChunkResult {
  id: string;
  knowledge_id: string;
  chunk_text: string;
  chunk_index: number;
  similarity: number;
  source: string;
  title: string;
  url: string | null;
  publication_date: string | null;
  topic: string;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].embedding as number[];
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push(chunk.trim());
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }
  return chunks;
}

export async function ensureEmbeddingsForKnowledge(knowledgeId: string, content: string): Promise<void> {
  // Check if chunks exist for this knowledge
  const { data: existing } = await supabase
    .from("knowledge_chunks")
    .select("id, chunk_index, embedding")
    .eq("knowledge_id", knowledgeId)
    .order("chunk_index");

  // If chunks exist and all have embeddings, skip
  if (existing && existing.length > 0) {
    const withoutEmbedding = existing.filter((c) => !c.embedding);
    if (withoutEmbedding.length === 0) return;

    // Some chunks exist but lack embeddings — generate and update them
    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i++) {
      const existingChunk = existing.find((c) => c.chunk_index === i);
      if (existingChunk && !existingChunk.embedding) {
        try {
          const embedding = await generateEmbedding(chunks[i]);
          await supabase
            .from("knowledge_chunks")
            .update({ embedding })
            .eq("id", existingChunk.id);
        } catch (err) {
          console.error(`Failed to embed chunk ${i} for knowledge ${knowledgeId}:`, err);
        }
      }
    }
    return;
  }

  // No chunks exist yet — create them with embeddings
  const chunks = chunkText(content);
  for (let i = 0; i < chunks.length; i++) {
    try {
      const embedding = await generateEmbedding(chunks[i]);
      await supabase.from("knowledge_chunks").insert({
        knowledge_id: knowledgeId,
        chunk_text: chunks[i],
        chunk_index: i,
        embedding,
      });
    } catch (err) {
      console.error(`Failed to embed chunk ${i} for knowledge ${knowledgeId}:`, err);
    }
  }
}

export async function ensureAllEmbeddings(): Promise<void> {
  const { data: knowledge, error } = await supabase
    .from("agronomic_knowledge")
    .select("id, content");

  if (error || !knowledge) return;

  for (const k of knowledge) {
    await ensureEmbeddingsForKnowledge(k.id, k.content);
  }
}

export async function retrieveRelevantKnowledge(
  query: string,
  matchCount = 3,
  matchThreshold = 0.68,
): Promise<KnowledgeChunkResult[]> {
  // Strategy: try semantic (vector) search first if API key is available,
  // then fall back to keyword search. This ensures RAG works even before
  // embeddings are generated.

  if (OPENAI_API_KEY) {
    try {
      const embedding = await generateEmbedding(query);

      const { data: vectorData, error: vectorError } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: embedding,
        match_count: matchCount,
        match_threshold: matchThreshold,
      });

      if (!vectorError && vectorData && vectorData.length > 0) {
        return vectorData as KnowledgeChunkResult[];
      }
    } catch (err) {
      console.error("Vector retrieval failed, falling back to keyword search:", err);
    }
  }

  // Keyword fallback — extract key terms from the query
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  for (const keyword of keywords) {
    const { data, error } = await supabase.rpc("search_knowledge_by_keyword", {
      search_query: keyword,
      match_count: matchCount,
    });

    if (!error && data && data.length > 0) {
      return (data as KnowledgeChunkResult[]).map((d) => ({
        ...d,
        similarity: 0,
        publication_date: (d as { publication_date?: string }).publication_date ?? null,
      }));
    }
  }

  return [];
}

function extractKeywords(query: string): string[] {
  const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "what", "which",
    "how", "when", "why", "do", "does", "did", "can", "could", "should", "would",
    "will", "my", "me", "i", "you", "your", "to", "for", "of", "in", "on", "at",
    "and", "or", "but", "with", "from", "about", "into", "than", "then", "so",
    "if", "as", "by", "this", "that", "these", "those", "it", "its",
  ]);

  const words = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Try multi-word phrases first (more specific), then single words
  const phrases: string[] = [];
  if (words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  // Add individual words, prioritizing domain terms
  const domainTerms = words.filter((w) =>
    ["irrigation", "fertilizer", "salinity", "moisture", "vwc", "nitrogen", "phosphorus",
     "potassium", "ph", "ec", "elevation", "slope", "topography", "rain", "water",
     "scarcity", "evapotranspiration", "soil", "crop", "tomato", "pepper", "drainage",
     "runoff", "leaching", "saturation", "priority", "nutrient", "salt"].includes(w)
  );

  return [...phrases, ...domainTerms, ...words].slice(0, 5);
}

export function formatKnowledgeContext(chunks: KnowledgeChunkResult[]): string {
  if (chunks.length === 0) return "";

  const sections = chunks.map((c) => {
    const sourceLine = c.url
      ? `Source: ${c.source} — ${c.title} (${c.url})`
      : `Source: ${c.source} — ${c.title}`;
    return `[${sourceLine}]\n${c.chunk_text}`;
  });

  return `Retrieved agronomic knowledge (use these as scientific grounding for your answer; cite sources when relevant):\n\n${sections.join("\n\n---\n\n")}`;
}
