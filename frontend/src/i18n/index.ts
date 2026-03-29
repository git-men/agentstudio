import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import zhCN_common from './locales/zh-CN/common.json';
import zhCN_pages from './locales/zh-CN/pages.json';
import zhCN_home from './locales/zh-CN/home.json';
import zhCN_components from './locales/zh-CN/components.json';
import zhCN_errors from './locales/zh-CN/errors.json';
import zhCN_agents from './locales/zh-CN/agents.json';
import zhCN_onboarding from './locales/zh-CN/onboarding.json';
import zhCN_skills from './locales/zh-CN/skills.json';
import zhCN_hooks from './locales/zh-CN/hooks.json';

import enUS_common from './locales/en-US/common.json';
import enUS_pages from './locales/en-US/pages.json';
import enUS_home from './locales/en-US/home.json';
import enUS_components from './locales/en-US/components.json';
import enUS_errors from './locales/en-US/errors.json';
import enUS_agents from './locales/en-US/agents.json';
import enUS_onboarding from './locales/en-US/onboarding.json';
import enUS_skills from './locales/en-US/skills.json';
import enUS_hooks from './locales/en-US/hooks.json';

const STORAGE_KEY = 'i18nextLng';

function detectLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      if (stored.startsWith('zh')) return 'zh-CN';
      if (stored.startsWith('en')) return 'en-US';
    }
  } catch { /* localStorage may be unavailable in some contexts */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (nav.startsWith('zh')) return 'zh-CN';
  return 'en-US';
}

const resources = {
  'zh-CN': {
    common: zhCN_common,
    pages: zhCN_pages,
    home: zhCN_home,
    components: zhCN_components,
    errors: zhCN_errors,
    agents: zhCN_agents,
    onboarding: zhCN_onboarding,
    skills: zhCN_skills,
    hooks: zhCN_hooks,
  },
  'en-US': {
    common: enUS_common,
    pages: enUS_pages,
    home: enUS_home,
    components: enUS_components,
    errors: enUS_errors,
    agents: enUS_agents,
    onboarding: enUS_onboarding,
    skills: enUS_skills,
    hooks: enUS_hooks,
  },
};

const resolvedLng = detectLanguage();
try { localStorage.setItem(STORAGE_KEY, resolvedLng); } catch { /* ignore */ }

/**
 * i18n.init() returns a Promise even with inline resources.
 * Export it so main.tsx can await before mounting React.
 */
export const i18nReady = i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: resolvedLng,
    fallbackLng: 'en-US',
    defaultNS: 'common',
    ns: ['common', 'pages', 'home', 'components', 'errors', 'agents', 'onboarding', 'skills', 'hooks'],
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', (lng: string) => {
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* ignore */ }
});

export default i18n;