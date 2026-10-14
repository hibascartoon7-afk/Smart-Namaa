import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Sparkles, Plus, MessageSquare, Trash2, Pencil, Check,
  ThumbsUp, ThumbsDown, RefreshCw, Loader2, Leaf,
  Cloud, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  sendChatMessage, listConversations, loadConversation,
  renameConversation, deleteConversation, submitFeedback,
  type ConversationSummary, type ConversationMessage,
} from '@/lib/chat-api';
import { PERSONAS, SUGGESTED_PROMPTS } from '@/data';
import type { Persona } from '@/types';

type UIMessage = ConversationMessage & { _error?: boolean };

const PERSONA_ACCENTS: Record<string, string> = {
  ghaith: '#105666',
  nada: '#D3968C',
};

function AlfalfaAvatar({ size = 40, accent = '#105666' }: { size?: number; accent?: string }) {
  return (
    <span className="grid place-items-center rounded-full shrink-0" style={{ width: size, height: size, background: `${accent}18`, border: `1.5px solid ${accent}40` }}>
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none" aria-hidden="true">
        <path d="M16 28 L16 10" stroke={accent} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M16 22 Q10 20 8 15 Q12 15 16 19M16 22 Q22 20 24 15 Q20 15 16 19M16 17 Q11 15 9 10 Q13 10 16 14M16 17 Q21 15 23 10 Q19 10 16 14M16 12 Q12 10 11 6 Q15 6 16 10M16 12 Q20 10 21 6 Q17 6 16 10" fill={accent} opacity=".82" />
        <circle cx="16" cy="28" r="1.2" fill={accent} />
      </svg>
    </span>
  );
}

function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyBase}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyBase}-${i}`} className="px-1.5 py-0.5 rounded bg-forest-700/10 text-forest-700 text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyBase}-${i}`}>{part}</span>;
  });
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let tableRows: string[][] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;
      if (!tableRows) tableRows = [];
      tableRows.push(cells);
      continue;
    }

    if (tableRows) {
      elements.push(
        <div key={`tbl-${i}`} className="overflow-x-auto my-2">
          <table className="w-full text-xs border-collapse">
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className={ri === 0 ? 'border-b-2 border-forest-700/20' : 'border-b border-forest-700/10'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-1.5 ${ri === 0 ? 'font-bold text-forest-700' : 'text-forest-700/80'}`}>{renderInline(cell, `tbl-${i}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = null;
    }

    if (!trimmed) { elements.push(<div key={i} className="h-2" />); continue; }
    if (trimmed.startsWith('### ')) { elements.push(<p key={i} className="font-display font-semibold text-sm text-forest-700 mt-2 mb-1">{renderInline(trimmed.slice(4), `l${i}`)}</p>); continue; }
    if (trimmed.startsWith('## ')) { elements.push(<p key={i} className="font-display font-semibold text-base text-forest-700 mt-2 mb-1">{renderInline(trimmed.slice(3), `l${i}`)}</p>); continue; }
    const isBullet = /^[-*]\s/.test(trimmed);
    if (isBullet) { elements.push(<div key={i} className="flex gap-2"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-moss-400 shrink-0" /><span>{renderInline(trimmed.slice(2), `l${i}`)}</span></div>); continue; }
    elements.push(<div key={i}>{renderInline(trimmed, `l${i}`)}</div>);
  }

  if (tableRows) {
    elements.push(
      <div key="tbl-final" className="overflow-x-auto my-2">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri} className="border-b border-forest-700/10">
                {row.map((cell, ci) => <td key={ci} className="px-3 py-1.5 text-forest-700/80">{renderInline(cell, `tbl-f-${ri}-${ci}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <div className="space-y-1.5 leading-relaxed">{elements}</div>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const MAX_INPUT = 2000;

export default function AIAssistantPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const { session } = useAuth();
  const [persona, setPersona] = useState<Persona>('ghaith');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, number>>({});
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConvList = useCallback(async () => {
    if (!session) return;
    setLoadingConvs(true);
    try {
      const convs = await listConversations();
      setConversations(convs);
    } catch { /* ignore */ } finally {
      setLoadingConvs(false);
    }
  }, [session]);

  useEffect(() => { if (session) loadConvList(); }, [session, loadConvList]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentConvId(null);
    setError('');
    inputRef.current?.focus();
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    try {
      const { conversation, messages: msgs } = await loadConversation(id);
      setCurrentConvId(id);
      setPersona(conversation.persona === 'nada' ? 'nada' : 'ghaith');
      setMessages(msgs as UIMessage[]);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversation');
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((c) => c.filter((conv) => conv.id !== id));
      if (currentConvId === id) startNewConversation();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }, [currentConvId, startNewConversation]);

  const handleRename = useCallback(async (id: string) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    try {
      await renameConversation(id, title);
      setConversations((c) => c.map((conv) => conv.id === id ? { ...conv, title } : conv));
    } catch { /* ignore */ }
    setEditingId(null);
  }, [editTitle]);

  const handleFeedback = useCallback(async (messageId: string, rating: number) => {
    if (feedbackGiven[messageId]) return;
    setFeedbackGiven((f) => ({ ...f, [messageId]: rating }));
    try { await submitFeedback(messageId, rating); } catch { /* ignore */ }
  }, [feedbackGiven]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || typing || !session) return;

    const userMsg: UIMessage = {
      id: `temp-u-${Date.now()}`,
      role: 'user',
      content,
      persona: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setError('');
    setTyping(true);

    try {
      const result = await sendChatMessage(content, persona, currentConvId ?? undefined);
      const assistantMsg: UIMessage = {
        id: result.message_id,
        role: 'assistant',
        content: result.content,
        persona: result.persona,
        created_at: new Date().toISOString(),
      };
      const newUserMsg: UIMessage = { ...userMsg, id: `u-${result.message_id}` };
      setMessages((m) => [...m.slice(0, -1), newUserMsg, assistantMsg]);
      setCurrentConvId(result.conversation_id);
      loadConvList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The agronomy assistant could not reply.');
      setMessages((m) => m.map((msg) => msg.id === userMsg.id ? { ...msg, _error: true } : msg));
    } finally {
      setTyping(false);
    }
  }, [input, typing, session, persona, currentConvId, loadConvList]);

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setMessages((m) => m.filter((msg) => msg.id !== lastUser.id));
      void send(lastUser.content);
    }
  }, [messages, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const p = PERSONAS[persona];
  const accent = PERSONA_ACCENTS[persona] ?? '#105666';
  const charCount = input.length;
  const charLimitReached = charCount >= MAX_INPUT;

  const greeting: UIMessage = {
    id: 'greeting',
    role: 'assistant',
    content: persona === 'ghaith'
      ? `Salam! I'm Ghaith (غيث), your irrigation and water strategist. I have live access to your field sensors, weather data, and agronomic calculations. Ask me anything about smart irrigation in Arabic or English.\n\nمرحباً! أنا غيث، مستشارك للري. اسألني أي سؤال عن الري الذكي بالعربية أو الإنجليزية.`
      : `Hello! I'm Nada (ندى), your soil nutrition and data scientist. I have live access to your field sensors, weather data, and agronomic calculations. Ask me anything about smart irrigation in Arabic or English.\n\nمرحباً! أنا ندى، عالمة تغذية التربة. اسألني أي سؤال عن الري الذكي بالعربية أو الإنجليزية.`,
    persona,
    created_at: new Date().toISOString(),
  };

  const displayMessages = messages.length > 0 ? messages : [greeting];

  return (
    <div className="fixed inset-0 flex flex-col bg-cream-100">
      {/* Top bar */}
      <header className="shrink-0 bg-forest-700 text-cream-100 px-4 py-3 flex items-center gap-3 shadow-lg z-20">
        <button onClick={onNavigateHome} className="flex items-center gap-2 hover:text-moss-200 transition group">
          <span className="relative grid place-items-center w-9 h-9 rounded-xl bg-forest-600 group-hover:scale-105 transition-transform">
            <Leaf className="w-4.5 h-4.5" strokeWidth={2.2} />
          </span>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-display text-lg font-semibold">NAMAA</span>
            <span className="text-[9px] tracking-[0.25em] text-moss-300 font-semibold uppercase">نماء</span>
          </div>
        </button>

        <div className="h-6 w-px bg-cream-100/20 mx-1 hidden sm:block" />

        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-moss-300" />
          <span className="font-display font-semibold text-sm sm:text-base">AI Smart Irrigation Assistant</span>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setSidebarOpen((s) => !s)}
          className="flex items-center gap-1.5 rounded-lg bg-forest-600 hover:bg-forest-500 px-3 py-1.5 text-xs font-medium transition"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">History</span>
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-64 sm:w-72 shrink-0 bg-white border-r border-forest-700/10 flex flex-col">
            <div className="p-3 border-b border-forest-700/10">
              <button
                onClick={startNewConversation}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-forest-600 text-cream-100 px-3 py-2.5 text-sm font-semibold hover:bg-forest-700 transition shadow-sm"
              >
                <Plus className="w-4 h-4" /> New conversation
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
              {loadingConvs && <div className="grid place-items-center py-6"><Loader2 className="w-5 h-5 text-forest-700/30 animate-spin" /></div>}

              {!loadingConvs && conversations.length === 0 && (
                <p className="text-xs text-forest-700/30 text-center py-6 px-3">No conversations yet. Start by asking a question below.</p>
              )}

              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group rounded-xl px-3 py-2.5 cursor-pointer transition ${conv.id === currentConvId ? 'bg-forest-600/10 text-forest-700' : 'hover:bg-forest-700/5 text-forest-700/70'}`}
                  onClick={() => void selectConversation(conv.id)}
                >
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleRename(conv.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="flex-1 min-w-0 bg-white border border-forest-700/20 rounded-lg px-2 py-1 text-xs outline-none focus:border-forest-600"
                        autoFocus
                      />
                      <button onClick={() => void handleRename(conv.id)} className="text-forest-600 p-1"><Check className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-40" />
                        <span className="truncate flex-1 text-xs font-medium">{conv.title}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 ml-5">
                        <span className="text-[9px] text-forest-700/30">{formatRelative(conv.updated_at)}</span>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={(e) => { e.stopPropagation(); setEditingId(conv.id); setEditTitle(conv.title); }} className="p-1 hover:bg-forest-700/10 rounded"><Pencil className="w-3 h-3 text-forest-700/40" /></button>
                          <button onClick={(e) => { e.stopPropagation(); void handleDelete(conv.id); }} className="p-1 hover:bg-rose-50 rounded"><Trash2 className="w-3 h-3 text-rose-400" /></button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-forest-700/10">
              <div className="flex items-center gap-2 text-[10px] text-forest-700/40">
                <Cloud className="w-3.5 h-3.5" />
                <span>Live weather · Open-Meteo</span>
              </div>
            </div>
          </aside>
        )}

        {/* Chat area */}
        <main className="flex-1 flex flex-col min-w-0 bg-cream-100">
          {/* Persona selector bar */}
          <div className="shrink-0 px-4 sm:px-6 py-3 bg-white/60 border-b border-forest-700/10 flex items-center gap-3">
            <AlfalfaAvatar size={36} accent={accent} />
            <div className="flex-1 min-w-0">
              <p className="font-display font-semibold text-forest-700 leading-none">{p.name} <span className="text-sm text-forest-700/50 font-arabic">{p.arabic}</span></p>
              <p className="text-[11px] text-forest-700/50 mt-0.5">{p.role}</p>
            </div>
            <div className="flex gap-2">
              {(Object.keys(PERSONAS) as Persona[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setPersona(key)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${key === persona ? 'bg-forest-600 text-cream-100 shadow' : 'bg-white/60 text-forest-700/60 hover:bg-white'}`}
                >
                  {PERSONAS[key].name} · <span className="font-arabic">{PERSONAS[key].arabic}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {displayMessages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'assistant' && <AlfalfaAvatar size={34} accent={PERSONA_ACCENTS[msg.persona ?? persona] ?? accent} />}
                  <div className={`max-w-[75%] flex flex-col gap-1`}>
                    <div
                      dir="auto"
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-forest-600 text-cream-100 rounded-tr-md' : 'bg-white text-forest-700 rounded-tl-md border border-forest-700/10 shadow-sm'} ${msg._error ? 'ring-2 ring-rose-300' : ''}`}
                    >
                      <MarkdownText text={msg.content} />
                    </div>
                    <div className={`flex items-center gap-2 text-[10px] text-forest-700/30 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <span>{formatTime(msg.created_at)}</span>
                      {msg.role === 'assistant' && msg.id !== 'greeting' && (
                        <div className="flex gap-1">
                          <button onClick={() => void handleFeedback(msg.id, 1)} className={`p-1 rounded hover:bg-moss-100 transition ${feedbackGiven[msg.id] === 1 ? 'text-moss-600' : 'text-forest-700/25'}`} aria-label="Good response">
                            <ThumbsUp className="w-3 h-3" />
                          </button>
                          <button onClick={() => void handleFeedback(msg.id, -1)} className={`p-1 rounded hover:bg-rose-50 transition ${feedbackGiven[msg.id] === -1 ? 'text-rose-400' : 'text-forest-700/25'}`} aria-label="Bad response">
                            <ThumbsDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {typing && (
                <div className="flex gap-3">
                  <AlfalfaAvatar size={34} accent={accent} />
                  <div className="bg-white rounded-2xl rounded-tl-md border border-forest-700/10 shadow-sm px-5 py-4 flex gap-1.5">
                    {[0, 1, 2].map((i) => <span key={i} className="w-2 h-2 rounded-full bg-forest-700/30 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-3 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 max-w-md mx-auto">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  <p className="flex-1 text-xs text-rose-600">{error}</p>
                  <button onClick={retryLast} className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 shrink-0">
                    <RefreshCw className="w-3 h-3" /> Retry
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Suggested prompts */}
          {messages.length === 0 && !typing && (
            <div className="shrink-0 px-4 sm:px-6 pb-3">
              <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS[persona].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void send(prompt)}
                    dir="auto"
                    className="text-xs rounded-full bg-moss-50 border border-moss-200 text-moss-700 px-3 py-1.5 hover:bg-moss-100 transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input composer */}
          <div className="shrink-0 px-4 sm:px-6 pb-4 pt-2 bg-cream-100">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-end gap-2 bg-white rounded-2xl border border-forest-700/15 shadow-sm focus-within:border-forest-600 focus-within:shadow-md transition p-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about irrigation, soil, weather, crops, or water... / اسأل عن الري، التربة، الطقس، المحاصيل، أو المياه..."
                  dir="auto"
                  rows={1}
                  maxLength={MAX_INPUT}
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-forest-700 placeholder:text-forest-700/35 outline-none resize-none min-h-[44px] max-h-32 leading-relaxed"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
                  }}
                />
                <button
                  onClick={() => void send()}
                  disabled={typing || !input.trim()}
                  className="grid place-items-center w-11 h-11 rounded-xl bg-forest-600 text-cream-100 hover:bg-forest-700 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
                  aria-label="Send message"
                >
                  <Send className="w-4.5 h-4.5" />
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5 px-1">
                <p className="text-[10px] text-forest-700/30">
                  Enter to send · Shift+Enter for new line
                </p>
                <p className={`text-[10px] transition ${charLimitReached ? 'text-rose-400 font-medium' : 'text-forest-700/25'}`}>
                  {charCount} / {MAX_INPUT}
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
