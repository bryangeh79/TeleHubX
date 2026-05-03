import React from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/accounts/AccountsPage';
import AccountDetailPage from './pages/accounts/AccountDetailPage';
import BindWizard from './pages/accounts/BindWizard';
import ImportAccounts from './pages/accounts/ImportAccounts';
import WarmupPage from './pages/warmup/WarmupPage';
import CampaignsPage from './pages/campaigns/CampaignsPage';
import CampaignForm from './pages/campaigns/CampaignForm';
import LeadsInbox from './pages/leads/LeadsInbox';
import LeadCandidatesPage from './pages/leads/LeadCandidatesPage';
import DiscoveredGroupsPage from './pages/discovered-groups/DiscoveredGroupsPage';
import AiSettingsPage from './pages/ai/AiSettingsPage';
import ProxiesPage from './pages/proxies/ProxiesPage';
import KnowledgePage from './pages/knowledge/KnowledgePage';
import CsPage from './pages/cs/CsPage';
import SettingsHubPage from './pages/settings/SettingsHubPage';
import SchedulerPage from './pages/scheduler/SchedulerPage';
import AdminPage from './pages/admin/AdminPage';
import AssetsPage from './pages/assets/AssetsPage';
import GroupsPage from './pages/groups/GroupsPage';
import ChatScriptsPage from './pages/chat-scripts/ChatScriptsPage';
import LoginPage from './pages/auth/LoginPage';
import ActivatePage from './pages/auth/ActivatePage';

// BrowserRouter and ConfigProvider live in main.tsx (single source).
// Wrapping again here threw "You cannot render a <Router> inside another <Router>".
const App: React.FC = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/activate" element={<ActivatePage />} />
    <Route path="/" element={<DashboardLayout />}>
      <Route index element={<DashboardPage />} />
      <Route path="accounts" element={<AccountsPage />} />
      <Route path="accounts/bind" element={<BindWizard />} />
      <Route path="accounts/import" element={<ImportAccounts />} />
      <Route path="accounts/:id" element={<AccountDetailPage />} />
      <Route path="warmup" element={<WarmupPage />} />
      <Route path="campaigns" element={<CampaignsPage />} />
      <Route path="campaigns/new" element={<CampaignForm />} />
      <Route path="campaigns/:id/edit" element={<CampaignForm />} />
      <Route path="proxies" element={<ProxiesPage />} />
      <Route path="leads" element={<LeadsInbox />} />
      <Route path="lead-candidates" element={<LeadCandidatesPage />} />
      <Route path="discovered-groups" element={<DiscoveredGroupsPage />} />
      <Route path="knowledge" element={<KnowledgePage />} />
      <Route path="cs" element={<CsPage />} />
      <Route path="ai" element={<AiSettingsPage />} />
      <Route path="settings" element={<SettingsHubPage />} />
      <Route path="scheduler" element={<SchedulerPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route path="assets" element={<AssetsPage />} />
      <Route path="groups" element={<GroupsPage />} />
      {/* /chat-scripts now lives as a tab inside /assets — kept as alias for back-compat */}
      <Route path="chat-scripts" element={<ChatScriptsPage />} />
    </Route>
  </Routes>
);

export default App;
