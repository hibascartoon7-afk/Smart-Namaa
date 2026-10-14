import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders, json } from "./lib/supabase.ts";
import { TOOL_DEFINITIONS, executeTool } from "./lib/tools.ts";
import { retrieveRelevantKnowledge, formatKnowledgeContext, ensureAllEmbeddings } from "./lib/rag.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const MODEL = "gpt-4o";
const MAX_TOKENS = 800;
const MAX_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 15;

const SYSTEM_PROMPT = `You are the AI Agronomist Assistant for the NAMAA (نماء) precision agriculture platform.

You have two personas that the user can switch between:
1. Ghaith (غيث): Friendly, practical, expert male agronomy advisor. Uses simple, farmer-friendly language. Action-oriented. May use Arabic naturally.
2. Nada (ندى): Precise, analytical, highly technical female agronomy advisor. Uses scientific terminology, explains calculations and reasoning.

LANGUAGE & BILINGUAL SUPPORT:
- The user may write in Arabic or English. You MUST detect the language of the user's message and reply in the SAME language.
- Arabic question → reply entirely in Arabic. English question → reply entirely in English.
- Do NOT mix languages within a single response unless the user mixed them.
- If the user switches language mid-conversation, switch your response language to match their latest message.
- Technical terms (VWC, EC, N, P, K, pH) may remain in English within Arabic responses, as these are standard abbreviations understood by Arabic-speaking agronomists.
- For Ghaith persona in Arabic: use warm, farmer-friendly MSA (Modern Standard Arabic). Keep it practical and easy to understand.
- For Nada persona in Arabic: use precise technical Arabic with scientific terminology, while remaining accessible.
- Arabic responses must be natural and clear, not awkward machine-translated text. English responses must be natural and professional.

AGRICULTURE-ONLY SCOPE:
- You specialize ONLY in precision agriculture, sub-surface 7-in-1 soil sensors (N, P, K, EC, Temp, pH, Moisture/VWC), micro-topography dynamics, smart irrigation, crops, soil, weather, water management, and sustainable farming.
- If the user asks something completely unrelated to agriculture, politely explain that you are specialized in smart irrigation, crops, soil, weather, water management, and agricultural advice. Suggest they ask an agriculture-related question instead.
- Do NOT attempt to answer non-agricultural questions under any circumstances.

Your Expertise & Domain Constraints:
- Ground all recommendations in verified FAO agronomic guidelines, soil science, and scientific formulas.
- Always translate raw sensor data into clear, human-friendly, practical instructions for farmers.
- Use the provided tools to fetch REAL sensor data, weather, and calculations. NEVER fabricate readings or weather data.
- If sensor data is stale or unavailable, clearly state this and do not pretend the reading is current.
- When recommending irrigation or fertilizer, always explain the reasoning including VWC, elevation, slope, weather, and EC factors.
- Do NOT invent exact fertilizer application rates unless all required data is available from tools.
- Do NOT invent sensor readings, weather information, scientific sources, or citations.
- Keep tone helpful, professional, and empathetic to farmers' practical needs.
- Use markdown formatting: **bold** for key values, bullet lists for steps, and tables when comparing meters.
- Cite sources from the knowledge base when retrieved content is used. Format citations as: Source: [Organization] — [Title]. Never fabricate citations.
- When retrieved knowledge is provided in the context, use it as the scientific basis for your answer and cite the source.`;

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface ConversationRow {
  id: string;
  user_id: string;
  persona: string;
  title: string;
  summary: string | null;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface AuthResult {
  userId: string;
  error: Response | null;
}

async function authenticate(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: "", error: json({ error: "Authentication required." }, 401) };
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return { userId: "", error: json({ error: "Invalid or expired session." }, 401) };
  }
  return { userId: user.id, error: null };
}

function generateTitle(content: string): string {
  const words = content.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.length > 0 ? words : "New conversation";
}

function buildContextualPrompt(persona: string): string {
  const personaInstruction = persona === "nada"
    ? "Speak as Nada (ندى): precise, analytical, highly technical, while remaining clear for farmers. Explain your scientific reasoning."
    : "Speak as Ghaith (غيث): friendly, practical, expert, and action-oriented for farmers. Use simple language and clear next steps.";
  return `${SYSTEM_PROMPT}\n\nActive persona: ${personaInstruction}`;
}

async function loadConversationHistory(conversationId: string, userId: string): Promise<ChatMessage[]> {
  const { data: messages } = await supabaseAdmin
    .from("ai_messages")
    .select("role, content, metadata")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);

  return (messages ?? []).map((m) => {
    const msg: ChatMessage = { role: m.role as ChatMessage["role"], content: m.content };
    if (m.metadata?.tool_calls) msg.tool_calls = m.metadata.tool_calls;
    return msg;
  });
}

async function storeMessage(
  conversationId: string, userId: string, role: string, content: string,
  persona: string | null, metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("ai_messages")
    .insert({ conversation_id: conversationId, user_id: userId, role, content, persona, metadata })
    .select("id")
    .maybeSingle();
  if (error) console.error("Failed to store message:", error.message);
  return data?.id ?? null;
}

async function storeToolCall(
  conversationId: string, messageId: string | null,
  toolName: string, input: unknown, output: unknown, status: string, latencyMs: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("ai_tool_calls")
    .insert({ conversation_id: conversationId, message_id: messageId, tool_name: toolName, input, output, status, latency_ms: latencyMs });
  if (error) console.error("Failed to store tool call:", error.message);
}

async function storeUsage(
  userId: string, conversationId: string, inputTokens: number, outputTokens: number,
): Promise<void> {
  const total = inputTokens + outputTokens;
  const cost = (inputTokens * 0.000005 + outputTokens * 0.000015);
  const { error } = await supabaseAdmin
    .from("ai_usage")
    .insert({ user_id: userId, conversation_id: conversationId, model: MODEL, input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: total, estimated_cost_usd: cost });
  if (error) console.error("Failed to store usage:", error.message);
}

async function checkRateLimit(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabaseAdmin
    .from("ai_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) { console.error("Rate limit check failed:", error.message); return true; }
  return (count ?? 0) < RATE_LIMIT_MAX_REQUESTS;
}

async function callOpenAI(messages: ChatMessage[], tools: ToolDef[], signal?: AbortSignal): Promise<{
  content: string | null; tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> | null;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto", max_tokens: MAX_TOKENS, temperature: 0.4 }),
    signal,
  });

  const result = await response.json();
  if (!response.ok) {
    const msg = result.error?.message || "OpenAI request failed";
    const status = response.status === 429 ? 429 : 502;
    throw new OpenAIError(msg, status);
  }

  const choice = result.choices?.[0]?.message;
  return {
    content: choice?.content ?? null,
    tool_calls: choice?.tool_calls ?? null,
    usage: result.usage ?? null,
  };
}

class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Only POST requests are supported." }, 405);

    const { userId, error: authError } = await authenticate(req);
    if (authError) return authError;

    if (!OPENAI_API_KEY) return json({ error: "OpenAI API key is not configured on the server. Contact the platform administrator." }, 503);

    const body = await req.json();
    const conversationId = body.conversation_id as string | undefined;
    const userContent = body.content as string;
    const persona = body.persona === "nada" ? "nada" : "ghaith";

    if (!userContent || typeof userContent !== "string") return json({ error: "Message content is required." }, 400);
    if (userContent.length > 2000) return json({ error: "Message too long (max 2000 characters)." }, 400);

    const allowed = await checkRateLimit(userId);
    if (!allowed) return json({ error: "Rate limit exceeded. Please wait a moment before sending another message." }, 429);

    // Get or create conversation
    let convId = conversationId;
    let conversation: ConversationRow | null = null;

    if (convId) {
      const { data: conv, error: convError } = await supabaseAdmin
        .from("ai_conversations")
        .select("*")
        .eq("id", convId)
        .eq("user_id", userId)
        .maybeSingle();
      if (convError || !conv) return json({ error: "Conversation not found." }, 404);
      conversation = conv as ConversationRow;
    } else {
      const title = generateTitle(userContent);
      const { data: newConv, error: createError } = await supabaseAdmin
        .from("ai_conversations")
        .insert({ user_id: userId, persona, title })
        .select("*")
        .maybeSingle();
      if (createError || !newConv) return json({ error: "Could not create conversation." }, 500);
      conversation = newConv as ConversationRow;
      convId = newConv.id;
    }

    // Store user message
    await storeMessage(convId!, userId, "user", userContent, null);

    // RAG: Retrieve relevant agronomic knowledge for the user's question
    let knowledgeContext = "";
    try {
      const chunks = await retrieveRelevantKnowledge(userContent, 3, 0.68);
      knowledgeContext = formatKnowledgeContext(chunks);
    } catch (err) {
      console.error("RAG retrieval failed:", err);
    }

    // Build message history
    const history = await loadConversationHistory(convId!, userId);
    const systemContent = buildContextualPrompt(persona) + (knowledgeContext ? `\n\n${knowledgeContext}` : "");
    const systemMsg: ChatMessage = { role: "system", content: systemContent };
    const allMessages: ChatMessage[] = [systemMsg, ...history];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // AI orchestration loop with tool calling
    let assistantContent = "";
    let lastResponse;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        lastResponse = await callOpenAI(allMessages, TOOL_DEFINITIONS, controller.signal);
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof OpenAIError) throw err;
        throw new OpenAIError("Request timed out. Please try again.", 504);
      }
      clearTimeout(timeout);

      if (lastResponse.usage) {
        totalInputTokens += lastResponse.usage.prompt_tokens;
        totalOutputTokens += lastResponse.usage.completion_tokens;
      }

      if (lastResponse.tool_calls && lastResponse.tool_calls.length > 0 && round < MAX_TOOL_ROUNDS) {
        allMessages.push({
          role: "assistant",
          content: lastResponse.content ?? "",
          tool_calls: lastResponse.tool_calls,
        });

        for (const tc of lastResponse.tool_calls) {
          const toolName = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

          const { output, latency_ms } = await executeTool(toolName, args);
          const status = (output as { error?: string })?.error ? "error" : "success";

          await storeToolCall(convId!, null, toolName, args, output, status, latency_ms);

          allMessages.push({
            role: "tool",
            content: JSON.stringify(output),
            tool_call_id: tc.id,
          });
        }
        continue;
      }

      assistantContent = lastResponse.content ?? "";
      break;
    }

    if (!assistantContent) {
      assistantContent = "I wasn't able to generate a response. Please try rephrasing your question.";
    }

    // Store assistant message
    const assistantMessageId = await storeMessage(convId!, userId, "assistant", assistantContent, persona, {
      model: MODEL,
      tool_calls_count: lastResponse?.tool_calls?.length ?? 0,
    });

    // Store usage
    await storeUsage(userId, convId!, totalInputTokens, totalOutputTokens);

    // Update conversation timestamp
    await supabaseAdmin.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

    // Ensure knowledge base embeddings exist (lazy ingestion, non-blocking)
    ensureAllEmbeddings().catch((e) => console.error("Embedding generation failed:", e));

    return json({
      conversation_id: convId,
      message_id: assistantMessageId,
      content: assistantContent,
      persona,
    });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return json({ error: error.message }, error.status);
    }
    console.error("Chat handler error:", error);
    return json({ error: "An unexpected error occurred. Please try again." }, 500);
  }
});
