// Shared by the Edge Functions: CORS, JSON answers, the admin client, user checks and the Db adapter for supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Db, Scalar, SelectOptions } from './engine/db.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec((req.headers.get('Authorization') ?? '').trim());
  return m ? m[1] : null;
}

/** true when the caller used the service-role key (the scheduler), compared in constant time */
export function isServiceCall(req: Request): boolean {
  const token = bearer(req);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !key || token.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= token.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/** true when the caller sent the scheduler secret (CRON_SECRET, at least 32 characters), compared in constant time */
export function isCronCall(req: Request): boolean {
  const token = bearer(req);
  const secret = Deno.env.get('CRON_SECRET');
  if (!token || !secret || secret.length < 32 || token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** the signed-in user of this request, or null */
export async function userOf(req: Request, admin: SupabaseClient): Promise<{ id: string } | null> {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

/** does this user own this field? (the answer for "not yours" and "does not exist" is the same on purpose) */
export async function ownsField(admin: SupabaseClient, userId: string, fieldId: string): Promise<boolean> {
  const { data } = await admin.from('fields').select('id').eq('id', fieldId).eq('owner_user_id', userId).maybeSingle();
  return !!data;
}

export class SupabaseDb implements Db {
  constructor(private readonly client: SupabaseClient) {}

  async select<T = Record<string, unknown>>(table: string, o: SelectOptions = {}): Promise<T[]> {
    // deno-lint-ignore no-explicit-any
    let q: any = this.client.from(table).select(o.columns ?? '*');
    for (const [c, v] of Object.entries(o.eq ?? {})) q = v === null ? q.is(c, null) : q.eq(c, v);
    for (const [c, v] of Object.entries(o.in ?? {})) q = q.in(c, v);
    for (const [c, v] of Object.entries(o.gte ?? {})) q = q.gte(c, v);
    for (const [c, v] of Object.entries(o.lte ?? {})) q = q.lte(c, v);
    if (o.order) q = q.order(o.order.column, { ascending: o.order.ascending !== false });
    if (o.limit) q = q.limit(o.limit);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async insert<T = Record<string, unknown>>(table: string, rows: Record<string, unknown>[], returning?: string): Promise<T[]> {
    // deno-lint-ignore no-explicit-any
    const q: any = this.client.from(table).insert(rows);
    const { data, error } = returning ? await q.select(returning) : await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as T[];
  }

  async upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
    const { error } = await this.client.from(table).upsert(row, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async upsertMany(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await this.client.from(table).upsert(rows.slice(i, i + 200), { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  async update(table: string, values: Record<string, unknown>, where: Record<string, Scalar>): Promise<void> {
    // deno-lint-ignore no-explicit-any
    let q: any = this.client.from(table).update(values);
    for (const [c, v] of Object.entries(where)) q = v === null ? q.is(c, null) : q.eq(c, v);
    const { error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** reads a JSON body of at most maxBytes; null when it is missing, too big or not JSON */
export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown | null> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
