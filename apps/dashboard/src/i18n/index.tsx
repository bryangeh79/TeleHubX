/**
 * 轻量 i18n: zero-dependency, 仅 React Context + useT() hook.
 *
 * 用法:
 *   import { useT } from '@/i18n';
 *   const t = useT();
 *   <Button>{t('common.save')}</Button>
 *   <span>{t('task.autoRetried', { n: 2, max: 2 })}</span>
 *
 * 优先级:
 *   1. localStorage 'telehubx.lang' (用户手动选择)
 *   2. navigator.language 浏览器语言
 *   3. fallback 'zh'
 *
 * 浏览器映射:
 *   zh-CN / zh-TW / zh-HK → zh
 *   en-* → en
 *   ms-* → ms
 *   vi-* → vi
 *   其他 → zh
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LANG_OPTIONS, MESSAGES } from './messages';
import type { Lang } from './messages';

const STORAGE_KEY = 'telehubx.lang';

function detectBrowserLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh';
  const raw = (navigator.language ?? '').toLowerCase();
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('ms')) return 'ms';
  if (raw.startsWith('vi')) return 'vi';
  return 'zh';
}

function loadInitialLang(): Lang {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && (saved === 'zh' || saved === 'en' || saved === 'ms' || saved === 'vi')) {
        return saved as Lang;
      }
    } catch {
      // 隐身模式 / localStorage 禁用 — fallback to detection
    }
  }
  return detectBrowserLang();
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadInitialLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  // Sync <html lang> for accessibility / browser hints
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = MESSAGES[lang] ?? MESSAGES.zh;
      const tpl = dict[key] ?? MESSAGES.zh[key] ?? key; // fallback chain: lang → zh → key
      return format(tpl, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used within <I18nProvider>');
  return v;
}

export function useT() {
  return useI18n().t;
}

export { LANG_OPTIONS };
export type { Lang };
