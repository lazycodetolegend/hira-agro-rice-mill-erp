import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';

export type Lang = 'en' | 'hi' | 'mr';

export const TRANSLATIONS: Record<Lang, typeof en> = {
  en,
  hi,
  mr,
};

export function translate(lang: Lang, key: string): string {
  const dict = TRANSLATIONS[lang] || en;
  const parts = key.split('.');
  let cur: any = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      cur = undefined;
      break;
    }
  }
  if (typeof cur === 'string') return cur;

  // Fallback to English
  let fallback: any = en;
  for (const p of parts) {
    if (fallback && typeof fallback === 'object' && p in fallback) {
      fallback = fallback[p];
    } else {
      return key;
    }
  }
  return typeof fallback === 'string' ? fallback : key;
}
