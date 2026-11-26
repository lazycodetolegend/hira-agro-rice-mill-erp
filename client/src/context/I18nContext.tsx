import React, { createContext, useContext, useState, useEffect } from 'react';
import { translate, type Lang } from '../i18n';
import { apiFetch, getAuthToken } from '../api/client';

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<I18nCtx>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('rm_lang');
    return saved === 'hi' || saved === 'mr' ? saved : 'en';
  });

  useEffect(() => {
    localStorage.setItem('rm_lang', lang);
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('rm_lang', l);
    if (getAuthToken() && navigator.onLine) {
      apiFetch('/auth/language', { method: 'PATCH', body: JSON.stringify({ lang: l }) }).catch(() => {});
    }
  };

  const t = (key: string) => translate(lang, key);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
