import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  SendOutlined,
  MessageOutlined,
  BookOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import AccountsPage from './pages/accounts/AccountsPage';
import BindWizard from './pages/accounts/BindWizard';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/accounts', icon: <UserOutlined />, label: 'Accounts' },
  { key: '/campaigns', icon: <SendOutlined />, label: 'Campaigns' },
  { key: '/reply', icon: <MessageOutlined />, label: 'AI Reply' },
  { key: '/knowledge-base', icon: <BookOutlined />, label: 'Knowledge Base' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

function getSelectedKey(pathname: string): string {
  if (pathname === '/') return '/';
  const match = menuItems
    .filter(item => item.key !== '/' && pathname.startsWith(item.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return match?.key ?? '/';
}

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: collapsed ? 16 : 20,
            fontWeight: 'bold',
            letterSpacing: 1,
          }}
        >
          {collapsed ? 'TX' : 'TeleHubX'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey(location.pathname)]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <span style={{ color: '#595959', fontSize: 14 }}>TeleHubX — Telegram Automation Platform</span>
        </Header>

        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          <Routes>
            <Route path="/" element={<div>Dashboard — Coming Soon</div>} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/bind" element={<BindWizard />} />
            <Route path="/campaigns" element={<div>Campaigns — Coming Soon</div>} />
            <Route path="/reply" element={<div>AI Reply — Coming Soon</div>} />
            <Route path="/knowledge-base" element={<div>Knowledge Base — Coming Soon</div>} />
            <Route path="/settings" element={<div>Settings — Coming Soon</div>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
