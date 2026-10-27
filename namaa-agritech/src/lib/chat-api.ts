import { supabase } from '@/lib/supabase';
import type { Persona } from '@/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSource {
  title: string;
  url: string | null;
}

export interface ChatReply {
  reply: string;
  sources: ChatSource[];
  decision_at: string | null;
}

export const MAX_INPUT = 2000;
/** the server keeps at most this many messages of the conversation */
export const MAX_TURNS = 12;

/** Ask Ghaith or Nada about ONE environment. The server checks the user owns it and builds the answer from the stored engine output. */
export async function sendChat(persona: Persona, fieldId: string, history: ChatTurn[]): Promise<ChatReply> {
  const messages = history.slice(-MAX_TURNS);
  const { data, error } = await supabase.functions.invoke('namaa-chat', { body: { persona, field_id: fieldId, messages } });
  if (error) {
    let text = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as { error?: string };
        if (body?.error) text = body.error;
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(text);
  }
  const d = data as Partial<ChatReply> | null;
  if (!d || typeof d.reply !== 'string') throw new Error('The assistant sent an empty answer.');
  return { reply: d.reply, sources: d.sources ?? [], decision_at: d.decision_at ?? null };
}
