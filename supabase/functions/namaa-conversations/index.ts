import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const user = await authenticate(req);
  if (!user) return json({ error: "Authentication required." }, 401);
  const userId = user.id;

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v2\/namaa-conversations/, "").replace(/^\/+/, "");

  // GET / — list conversations
  if (req.method === "GET" && !path) {
    const { data, error } = await supabaseAdmin
      .from("ai_conversations")
      .select("id, persona, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return json({ error: "Failed to load conversations." }, 500);
    return json({ conversations: data });
  }

  // GET /:id — load conversation messages
  const conversationMatch = path.match(/^([0-9a-f-]+)$/);
  if (req.method === "GET" && conversationMatch) {
    const convId = conversationMatch[1];
    const { data: conv, error: convError } = await supabaseAdmin
      .from("ai_conversations")
      .select("*")
      .eq("id", convId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convError || !conv) return json({ error: "Conversation not found." }, 404);

    const { data: messages, error: msgError } = await supabaseAdmin
      .from("ai_messages")
      .select("id, role, content, persona, created_at")
      .eq("conversation_id", convId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (msgError) return json({ error: "Failed to load messages." }, 500);

    return json({ conversation: conv, messages: messages ?? [] });
  }

  // PATCH /:id — rename conversation
  if (req.method === "PATCH" && conversationMatch) {
    const convId = conversationMatch[1];
    const body = await req.json();
    const title = body.title as string;
    if (!title || title.length > 100) return json({ error: "Invalid title." }, 400);

    const { error } = await supabaseAdmin
      .from("ai_conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", convId)
      .eq("user_id", userId);
    if (error) return json({ error: "Failed to rename conversation." }, 500);
    return json({ success: true });
  }

  // DELETE /:id — delete conversation
  if (req.method === "DELETE" && conversationMatch) {
    const convId = conversationMatch[1];
    const { error } = await supabaseAdmin
      .from("ai_conversations")
      .delete()
      .eq("id", convId)
      .eq("user_id", userId);
    if (error) return json({ error: "Failed to delete conversation." }, 500);
    return json({ success: true });
  }

  // POST /feedback — store feedback
  if (req.method === "POST" && path === "feedback") {
    const body = await req.json();
    const messageId = body.message_id as string;
    const rating = body.rating as number;
    const feedback = body.feedback as string | undefined;

    if (!messageId || typeof rating !== "number") return json({ error: "Invalid feedback data." }, 400);

    const { error } = await supabaseAdmin
      .from("ai_feedback")
      .insert({ message_id: messageId, user_id: userId, rating, feedback });
    if (error) return json({ error: "Failed to store feedback." }, 500);
    return json({ success: true });
  }

  // GET /usage — usage stats
  if (req.method === "GET" && path === "usage") {
    const { data, error } = await supabaseAdmin
      .from("ai_usage")
      .select("model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ error: "Failed to load usage." }, 500);

    const totalTokens = (data ?? []).reduce((sum, u) => sum + u.total_tokens, 0);
    const totalCost = (data ?? []).reduce((sum, u) => sum + Number(u.estimated_cost_usd), 0);
    return json({ usage: data, total_tokens: totalTokens, total_cost_usd: Math.round(totalCost * 10000) / 10000 });
  }

  return json({ error: "Not found." }, 404);
});
