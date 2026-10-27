import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ar';

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'ltr' | 'rtl';
}

const LangContext = createContext<LangValue | undefined>(undefined);
const KEY = 'namaa.lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage can be blocked: fall back to English */
  }
  return 'en';
}

/** Language of the texts that come from the engine (alerts, decisions). Fixed interface labels stay English. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);
  const value = useMemo<LangValue>(() => ({ lang, setLang: setLangState, dir: lang === 'ar' ? 'rtl' : 'ltr' }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
}
