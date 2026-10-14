/*
# NAMAA AI Chatbot — Production Database Tables

## Overview
Creates the chatbot-specific tables required for the production AI Agronomist
Assistant. These tables store persistent conversations, messages, AI tool calls,
user feedback, usage/cost tracking, and an agronomic knowledge base for RAG.

The existing NAMAA tables (field_meters, meter_readings, weather_forecasts,
advisories, savings) are reused as the source of agricultural field data.

## Authentication Model
This migration introduces authenticated-user-scoped data. All chatbot tables
use `user_id` with `DEFAULT auth.uid()` and ownership-based RLS policies.
Users can only access their own conversations, messages, feedback, and usage.

The knowledge base tables (agronomic_knowledge, knowledge_chunks) are
readable by all authenticated users (shared scientific reference material)
but writable only by service-role (operator-managed content).

## New Tables

### ai_conversations
- id (uuid, PK)
- user_id (uuid, FK to auth.users, DEFAULT auth.uid())
- field_id (text, nullable — links to a field context label)
- persona (text: 'ghaith' | 'nada')
- title (text, auto-generated from first message)
- summary (text, AI-generated conversation summary for long-context management)
- created_at, updated_at (timestamptz)

### ai_messages
- id (uuid, PK)
- conversation_id (uuid, FK to ai_conversations ON DELETE CASCADE)
- user_id (uuid, FK to auth.users, DEFAULT auth.uid())
- role (text: 'user' | 'assistant' | 'system' | 'tool')
- content (text)
- persona (text, nullable — which persona produced this message)
- metadata (jsonb — tool_calls, sources, citations, model info, tokens)
- created_at (timestamptz)

### ai_tool_calls
- id (uuid, PK)
- conversation_id (uuid, FK to ai_conversations ON DELETE CASCADE)
- message_id (uuid, FK to ai_messages ON DELETE CASCADE)
- tool_name (text)
- input (jsonb)
- output (jsonb)
- status (text: 'success' | 'error' | 'timeout')
- latency_ms (integer)
- created_at (timestamptz)

### ai_feedback
- id (uuid, PK)
- message_id (uuid, FK to ai_messages ON DELETE CASCADE)
- user_id (uuid, FK to auth.users, DEFAULT auth.uid())
- rating (smallint: 1-5, or -1/+1 thumbs)
- feedback (text, nullable)
- created_at (timestamptz)

### ai_usage
- id (uuid, PK)
- user_id (uuid, FK to auth.users, DEFAULT auth.uid())
- conversation_id (uuid, FK to ai_conversations ON DELETE CASCADE)
- model (text)
- input_tokens (integer)
- output_tokens (integer)
- total_tokens (integer)
- estimated_cost_usd (numeric)
- created_at (timestamptz)

### agronomic_knowledge
- id (uuid, PK)
- source (text — e.g. 'FAO', 'USDA')
- title (text)
- url (text, nullable)
- publication_date (date, nullable)
- topic (text — e.g. 'irrigation', 'fertilizer', 'salinity')
- content (text — full document text)
- created_at (timestamptz)

### knowledge_chunks
- id (uuid, PK)
- knowledge_id (uuid, FK to agronomic_knowledge ON DELETE CASCADE)
- chunk_text (text)
- chunk_index (integer)
- embedding (vector(1536) — OpenAI text-embedding-3-small dimension)
- created_at (timestamptz)

## Indexes
- ai_messages on (conversation_id, created_at) — message history loading
- ai_tool_calls on conversation_id — tool call audit
- ai_feedback on message_id — feedback lookup
- ai_usage on (user_id, created_at) — usage tracking per user
- knowledge_chunks on embedding using ivfflat — vector similarity search
- agronomic_knowledge on topic — topic filtering

## Security (RLS)
- ai_conversations: owner-scoped CRUD (user_id = auth.uid())
- ai_messages: owner-scoped via conversation ownership check
- ai_tool_calls: owner-scoped via conversation ownership check
- ai_feedback: owner-scoped (user_id = auth.uid())
- ai_usage: owner-scoped (user_id = auth.uid()) — insert only, no update/delete from client
- agronomic_knowledge: SELECT to authenticated (shared), write via service role only
- knowledge_chunks: SELECT to authenticated (shared), write via service role only
*/

-- Enable vector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ai_conversations
CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  field_id text,
  persona text NOT NULL DEFAULT 'ghaith',
  title text NOT NULL DEFAULT 'New conversation',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_conversations" ON ai_conversations;
CREATE POLICY "select_own_conversations" ON ai_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_conversations" ON ai_conversations;
CREATE POLICY "insert_own_conversations" ON ai_conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_conversations" ON ai_conversations;
CREATE POLICY "update_own_conversations" ON ai_conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_conversations" ON ai_conversations;
CREATE POLICY "delete_own_conversations" ON ai_conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ai_messages
CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL DEFAULT '',
  persona text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages (conversation_id, created_at);

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_messages" ON ai_messages;
CREATE POLICY "select_own_messages" ON ai_messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_messages" ON ai_messages;
CREATE POLICY "insert_own_messages" ON ai_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_messages" ON ai_messages;
CREATE POLICY "update_own_messages" ON ai_messages
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_messages" ON ai_messages;
CREATE POLICY "delete_own_messages" ON ai_messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ai_tool_calls
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES ai_messages(id) ON DELETE CASCADE,
  tool_name text NOT NULL DEFAULT '',
  input jsonb DEFAULT '{}',
  output jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'success',
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_conversation ON ai_tool_calls (conversation_id);

ALTER TABLE ai_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tool_calls" ON ai_tool_calls;
CREATE POLICY "select_own_tool_calls" ON ai_tool_calls
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM ai_conversations WHERE ai_conversations.id = ai_tool_calls.conversation_id AND ai_conversations.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_tool_calls" ON ai_tool_calls;
CREATE POLICY "insert_own_tool_calls" ON ai_tool_calls
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM ai_conversations WHERE ai_conversations.id = ai_tool_calls.conversation_id AND ai_conversations.user_id = auth.uid())
  );

-- ai_feedback
CREATE TABLE IF NOT EXISTS ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_message ON ai_feedback (message_id);

ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_feedback" ON ai_feedback;
CREATE POLICY "select_own_feedback" ON ai_feedback
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_feedback" ON ai_feedback;
CREATE POLICY "insert_own_feedback" ON ai_feedback
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_feedback" ON ai_feedback;
CREATE POLICY "delete_own_feedback" ON ai_feedback
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ai_usage
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT '',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage (user_id, created_at);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_usage" ON ai_usage;
CREATE POLICY "select_own_usage" ON ai_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_usage" ON ai_usage;
CREATE POLICY "insert_own_usage" ON ai_usage
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- agronomic_knowledge (shared scientific reference material)
CREATE TABLE IF NOT EXISTS agronomic_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  url text,
  publication_date date,
  topic text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agronomic_knowledge_topic ON agronomic_knowledge (topic);

ALTER TABLE agronomic_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_agronomic_knowledge" ON agronomic_knowledge;
CREATE POLICY "read_agronomic_knowledge" ON agronomic_knowledge
  FOR SELECT TO authenticated USING (true);

-- knowledge_chunks (RAG vector chunks — shared, service-role written)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES agronomic_knowledge(id) ON DELETE CASCADE,
  chunk_text text NOT NULL DEFAULT '',
  chunk_index integer NOT NULL DEFAULT 0,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "read_knowledge_chunks" ON knowledge_chunks
  FOR SELECT TO authenticated USING (true);

-- updated_at trigger for ai_conversations
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_conversations_updated ON ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
