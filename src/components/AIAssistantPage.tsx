import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, RefreshCw, Loader2, Leaf, AlertCircle, ExternalLink } from 'lucide-react';
import { useFieldData } from '@/lib/field-data';
import { sendChat, MAX_INPUT, type ChatSource, type ChatTurn } from '@/lib/chat-api';
import { PERSONAS, SUGGESTED_PROMPTS } from '@/personas';
import type { Persona } from '@/types';

interface UIMessage extends ChatTurn {
  id: string;
  at: string;
  persona?: Persona;
  sources?: ChatSource[];
}

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


let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

export default function AIAssistantPage({ onNavigateHome, initialPersona = 'ghaith' }: { onNavigateHome: () => void; initialPersona?: Persona }) {
  const { fields, field, selectField, signedIn, loading } = useFieldData();
  const [persona, setPersona] = useState<Persona>(initialPersona);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const p = PERSONAS[persona];
  const accent = PERSONA_ACCENTS[persona] ?? p.accent;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  // a different environment means a different conversation: the answers are about ONE environment
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [field?.id]);

  const ask = async (text: string, base: UIMessage[] = messages) => {
    const content = text.trim().slice(0, MAX_INPUT);
    if (!content || !field || typing) return;
    const userMsg: UIMessage = { id: nextId(), role: 'user', content, at: new Date().toISOString() };
    const next = [...base, userMsg];
    setMessages(next);
    setInput('');
    setError(null);
    setTyping(true);
    try {
      const res = await sendChat(persona, field.id, next.map(({ role, content: c }) => ({ role, content: c })));
      setMessages([...next, { id: nextId(), role: 'assistant', content: res.reply, at: new Date().toISOString(), persona, sources: res.sources }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not answer.');
    } finally {
      setTyping(false);
    }
  };

  const retry = () => {
    // resend the last question (the failed answer was never added)
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') void ask(last.content, messages.slice(0, -1));
  };

  const blocked = !signedIn ? 'Sign in first.' : loading ? 'Loading your environments…' : !field ? 'Create an environment first: the answers are about its sensors, weather and decisions.' : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-cream-100">
      <header className="shrink-0 bg-forest-700 text-cream-100 px-4 py-3 flex items-center gap-3 shadow-lg z-20">
        <button onClick={onNavigateHome} className="flex items-center gap-2 hover:text-moss-200 transition group">
          <span className="relative grid place-items-center w-9 h-9 rounded-xl bg-forest-600 group-hover:bg-moss-600 transition-colors">
            <Leaf className="w-4 h-4" strokeWidth={2.2} />
          </span>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-display text-lg font-semibold">NAMAA</span>
            <span className="text-[9px] tracking-[0.25em] text-moss-300 font-semibold uppercase">نماء</span>
          </div>
        </button>
        <div className="h-6 w-px bg-cream-100/20 mx-1 hidden sm:block" />
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-moss-300" />
          <span className="font-display font-semibold text-sm sm:text-base">Ask about your environment</span>
        </div>
        <div className="flex-1" />
        {fields.length > 0 && (
          <select
            value={field?.id ?? ''}
            onChange={(e) => selectField(e.target.value)}
            className="rounded-lg bg-forest-600 hover:bg-moss-600 text-cream-100 text-xs font-medium px-3 py-1.5 outline-none transition"
            aria-label="Environment"
          >
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}{f.crop_name ? ` · ${f.crop_name}` : ''}</option>)}
          </select>
        )}
      </header>

      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-cream-100">
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
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${key === persona ? 'bg-forest-600 text-cream-100 shadow' : 'bg-white/60 text-forest-700/60 hover:bg-forest-600 hover:text-cream-100'}`}
              >
                {PERSONAS[key].name} · <span className="font-arabic">{PERSONAS[key].arabic}</span>
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {blocked && <div className="glass-card p-6 text-sm text-forest-700/70 text-center">{blocked}</div>}

            {!blocked && messages.length === 0 && (
              <div className="flex gap-3">
                <AlfalfaAvatar size={34} accent={accent} />
                <div className="max-w-[75%] bg-white text-forest-700 rounded-2xl rounded-tl-md border border-forest-700/10 shadow-sm px-4 py-3 text-sm leading-relaxed" dir="auto">
                  <p>
                    Hi, I am {p.name} ({p.arabic}). Ask me about <strong>{field?.name}</strong>: I answer from what the decision engine stored for it (sensors, weather, crop, soil)
                    and, for general farming questions, only from the reference sources I have.
                  </p>
                  <p className="mt-2 font-arabic" dir="rtl">أنا {p.arabic}. اسألني عن «{field?.name}»: أجيب من قرارات المحرك وقراءات المجسات، وللأسئلة العامة من المصادر المرجعية فقط.</p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {msg.role === 'assistant' && <AlfalfaAvatar size={34} accent={PERSONA_ACCENTS[msg.persona ?? persona] ?? accent} />}
                <div className="max-w-[75%] flex flex-col gap-1">
                  <div
                    dir="auto"
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-forest-600 text-cream-100 rounded-tr-md' : 'bg-white text-forest-700 rounded-tl-md border border-forest-700/10 shadow-sm'}`}
                  >
                    <MarkdownText text={msg.content} />
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-forest-700/50">
                      <span>Sources:</span>
                      {msg.sources.map((s) =>
                        s.url ? (
                          <a key={s.title} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-moss-600">{s.title}<ExternalLink className="w-2.5 h-2.5" /></a>
                        ) : (
                          <span key={s.title}>{s.title}</span>
                        ),
                      )}
                    </div>
                  )}
                  <span className={`text-[10px] text-forest-700/30 ${msg.role === 'user' ? 'text-end' : ''}`}>{formatTime(msg.at)}</span>
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
                <button onClick={retry} className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 shrink-0">
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {!blocked && messages.length === 0 && !typing && (
          <div className="shrink-0 px-4 sm:px-6 pb-3">
            <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS[persona].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => void ask(prompt)}
                  dir="auto"
                  className="text-xs rounded-full bg-moss-50 border border-moss-200 text-moss-700 px-3 py-1.5 hover:bg-moss-600 hover:text-white transition"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 px-4 sm:px-6 pb-4 pt-2 bg-cream-100">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-white rounded-2xl border border-forest-700/15 shadow-sm focus-within:border-forest-600 focus-within:shadow-md transition p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                dir="auto"
                rows={1}
                disabled={!!blocked}
                placeholder={blocked ? '' : `Ask ${p.name}… / اسأل ${p.arabic}…`}
                className="flex-1 resize-none bg-transparent outline-none px-3 py-2 text-sm text-forest-700 placeholder:text-forest-700/30 max-h-32"
              />
              <button
                onClick={() => void ask(input)}
                disabled={!input.trim() || typing || !!blocked}
                className="grid place-items-center w-10 h-10 rounded-xl bg-forest-600 text-cream-100 hover:bg-moss-600 disabled:opacity-40 disabled:hover:bg-forest-600 transition"
                aria-label="Send"
              >
                {typing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-forest-700/40 text-center mt-2">
              Decisions and numbers come from the NAMAA engine. The assistant explains them; it does not decide.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
