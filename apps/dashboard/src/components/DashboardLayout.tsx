import { useMemo } from 'react';
import { Layout, Menu, Typography, theme } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  RocketOutlined,
  SendOutlined,
  InboxOutlined,
  RobotOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

const MENU_ITEMS = [
  { key: '/',           icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/accounts',   icon: <TeamOutlined />,      label: 'Accounts' },
  { key: '/proxies',    icon: <GlobalOutlined />,    label: 'Proxies' },
  { key: '/warmup',     icon: <RocketOutlined />,    label: 'Warmup' },
  { key: '/campaigns',  icon: <SendOutlined />,      label: 'Campaigns' },
  { key: '/leads',      icon: <InboxOutlined />,     label: 'Leads' },
  { key: '/ai',         icon: <RobotOutlined />,     label: 'AI Settings' },
];

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const selectedKey = useMemo(() => {
    const match = MENU_ITEMS
      .map(i => i.key)
      .filter(k => k === '/' ? location.pathname === '/' : location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? '/';
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Title level={5} style={{ margin: 0, color: token.colorPrimary }}>TeleHubX</Title>
          <Text type="secondary" style={{ fontSize: 11 }}>v1.0</Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          items={MENU_ITEMS}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: token.colorBgContainer, padding: '0 24px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Text strong>TeleHubX Operations Console</Text>
        </Header>
        <Content style={{ margin: 24, background: token.colorBgContainer, padding: 24, borderRadius: token.borderRadiusLG }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
