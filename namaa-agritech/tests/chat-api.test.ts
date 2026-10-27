import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

const { sendChat, MAX_TURNS, MAX_INPUT } = await import('../src/lib/chat-api');

const FIELD = '33333333-3333-3333-3333-333333333333';
const ask = (content: string) => [{ role: 'user' as const, content }];

beforeEach(() => invoke.mockReset());

describe('sendChat -> Edge Function namaa-chat', () => {
  it('calls the function namaa-chat with the persona, the environment id and the messages', async () => {
    invoke.mockResolvedValue({ data: { reply: 'Irrigate tomorrow.', sources: [{ title: 'FAO-56', url: 'https://www.fao.org' }], decision_at: '2026-10-23T05:00:00Z' }, error: null });
    const res = await sendChat('ghaith', FIELD, ask('Should I irrigate today?'));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('namaa-chat', { body: { persona: 'ghaith', field_id: FIELD, messages: ask('Should I irrigate today?') } });
    expect(res).toEqual({ reply: 'Irrigate tomorrow.', sources: [{ title: 'FAO-56', url: 'https://www.fao.org' }], decision_at: '2026-10-23T05:00:00Z' });
  });

  it('sends only the last MAX_TURNS messages (the server accepts at most that many)', async () => {
    invoke.mockResolvedValue({ data: { reply: 'ok' }, error: null });
    const history = Array.from({ length: MAX_TURNS + 5 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: `m${i}` }));
    history.push({ role: 'user', content: 'last' });
    await sendChat('nada', FIELD, history);
    const sent = invoke.mock.calls[0][1].body.messages;
    expect(sent).toHaveLength(MAX_TURNS);
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'last' });
  });

  it('fills missing sources and decision date with empty values (never invented ones)', async () => {
    invoke.mockResolvedValue({ data: { reply: 'No source found for that.' }, error: null });
    expect(await sendChat('nada', FIELD, ask('q'))).toEqual({ reply: 'No source found for that.', sources: [], decision_at: null });
  });

  it('shows the error text the function sent (for example: sign in first)', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { json: async () => ({ error: 'sign in first' }) },
    });
    invoke.mockResolvedValue({ data: null, error });
    await expect(sendChat('ghaith', FIELD, ask('q'))).rejects.toThrow('sign in first');
  });

  it('falls back to the generic message when the error body is not JSON', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { json: async () => { throw new Error('not json'); } },
    });
    invoke.mockResolvedValue({ data: null, error });
    await expect(sendChat('ghaith', FIELD, ask('q'))).rejects.toThrow('non-2xx');
  });

  it('refuses an empty answer', async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(sendChat('ghaith', FIELD, ask('q'))).rejects.toThrow(/empty answer/);
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(sendChat('ghaith', FIELD, ask('q'))).rejects.toThrow(/empty answer/);
  });

  it('uses the same limits as the server (chat.ts CHAT_LIMITS)', async () => {
    const { CHAT_LIMITS } = await import('../../src/engine/chat');
    expect(MAX_TURNS).toBe(CHAT_LIMITS.maxMessages);
    expect(MAX_INPUT).toBe(CHAT_LIMITS.maxMessageChars);
  });
});
