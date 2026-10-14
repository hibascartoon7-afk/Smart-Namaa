import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data[0].embedding as number[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);

    if (!OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is not configured on the server." }, 503);
    }

    // Find all chunks that have no embedding
    const { data: chunksWithoutEmbeddings, error: fetchError } = await supabaseAdmin
      .from("knowledge_chunks")
      .select("id, chunk_text, knowledge_id")
      .is("embedding", "null")
      .order("knowledge_id")
      .order("chunk_index");

    if (fetchError) {
      return json({ error: "Failed to fetch chunks: " + fetchError.message }, 500);
    }

    if (!chunksWithoutEmbeddings || chunksWithoutEmbeddings.length === 0) {
      // All embeddings exist — verify count
      const { count } = await supabaseAdmin
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null);

      return json({
        status: "already_embedded",
        embedded_count: count ?? 0,
        total_chunks: 17,
      });
    }

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const chunk of chunksWithoutEmbeddings) {
      try {
        const embedding = await generateEmbedding(chunk.chunk_text);

        const { error: updateError } = await supabaseAdmin
          .from("knowledge_chunks")
          .update({ embedding })
          .eq("id", chunk.id);

        if (updateError) {
          failCount++;
          errors.push(`Chunk ${chunk.id}: ${updateError.message}`);
        } else {
          successCount++;
        }
      } catch (err) {
        failCount++;
        errors.push(`Chunk ${chunk.id}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    return json({
      status: "completed",
      total_without_embeddings: chunksWithoutEmbeddings.length,
      success: successCount,
      failed: failCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Embedding generation error:", error);
    return json({ error: "Failed to generate embeddings." }, 500);
  }
});
