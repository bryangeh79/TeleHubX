import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import DashboardLayout from './components/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/accounts/AccountsPage';
import BindWizard from './pages/accounts/BindWizard';
import ImportAccounts from './pages/accounts/ImportAccounts';
import WarmupPage from './pages/warmup/WarmupPage';
import CampaignsPage from './pages/campaigns/CampaignsPage';
import CampaignForm from './pages/campaigns/CampaignForm';
import LeadsInbox from './pages/leads/LeadsInbox';
import AiSettingsPage from './pages/ai/AiSettingsPage';

const App: React.FC = () => (
  <ConfigProvider theme={{ token: { colorPrimary: '#1677ff' } }}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/bind" element={<BindWizard />} />
          <Route path="accounts/import" element={<ImportAccounts />} />
          <Route path="warmup" element={<WarmupPage />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/new" element={<CampaignForm />} />
          <Route path="campaigns/:id/edit" element={<CampaignForm />} />
          <Route path="leads" element={<LeadsInbox />} />
          <Route path="ai" element={<AiSettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ConfigProvider>
);

export default App;
