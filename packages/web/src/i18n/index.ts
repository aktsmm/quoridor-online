/**
 * Tiny typed i18n. A library would add a dependency and a bundle for what is
 * really two flat dictionaries, and keying off `Dictionary` gives us a compile
 * error the moment `en` and `ja` drift apart.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en, type Dictionary } from './en.js';
import { ja } from './ja.js';

export type Lang = 'ja' | 'en';
export type { Dictionary };
export type MessageKey = keyof Dictionary;

const DICTIONARIES: Record<Lang, Dictionary> = { en, ja };
const STORAGE_KEY = 'quoridor.lang';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch {
    // Private mode or blocked storage: fall through to the browser preference.
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

export function useProvideI18n(): I18nValue {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not worth breaking the app.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(DICTIONARIES[lang][key], vars),
    [lang],
  );

  return useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
}

export const I18nProvider = I18nContext.Provider;

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
