import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import viVN from 'antd/locale/vi_VN';
import msMY from 'antd/locale/ms_MY';
import App from './App';
import { I18nProvider, useI18n } from './i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const ANTD_LOCALES = { zh: zhCN, en: enUS, ms: msMY, vi: viVN } as const;

function AppWithLocale() {
  const { lang } = useI18n();
  const antdLocale = ANTD_LOCALES[lang] ?? zhCN;
  return (
    <ConfigProvider locale={antdLocale}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AppWithLocale />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
