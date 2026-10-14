/*
# NAMAA RAG — Vector similarity search function

Creates a SECURITY DEFINER function that performs semantic search over
knowledge_chunks using pgvector cosine distance. SECURITY DEFINER is used
because knowledge_chunks has RLS enabled (readable to authenticated users),
and the function is called from edge functions using the service role key
which bypasses RLS — but we also want this callable by authenticated users
directly if needed.

The function:
1. Generates an embedding for the query text using OpenAI's API
2. Performs cosine similarity search against knowledge_chunks
3. Returns matching chunks with source metadata from agronomic_knowledge

Note: The embedding generation happens server-side in the edge function.
This database function accepts a pre-computed embedding vector and returns
matching chunks. This avoids storing the OpenAI key in the database.
*/

CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.72
)
RETURNS TABLE (
  id uuid,
  knowledge_id uuid,
  chunk_text text,
  chunk_index int,
  similarity float,
  source text,
  title text,
  url text,
  publication_date date,
  topic text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kc.id,
    kc.knowledge_id,
    kc.chunk_text,
    kc.chunk_index,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    ak.source,
    ak.title,
    ak.url,
    ak.publication_date,
    ak.topic
  FROM knowledge_chunks kc
  JOIN agronomic_knowledge ak ON ak.id = kc.knowledge_id
  WHERE 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION match_knowledge_chunks(vector(1536), int, float) TO authenticated;
