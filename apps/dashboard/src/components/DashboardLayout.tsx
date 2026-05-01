import { useMemo } from 'react';
import { Avatar, Button, Dropdown, Layout, Menu, Space, Typography, theme } from 'antd';
import {
  CrownOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  InboxOutlined,
  LogoutOutlined,
  ScheduleOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

interface StoredUser {
  username?: string;
  role?: string;
  tenantName?: string;
}

function readStoredUser(): StoredUser {
  try {
    const raw = localStorage.getItem('telehubx:user');
    return raw ? (JSON.parse(raw) as StoredUser) : {};
  } catch {
    return {};
  }
}

const MENU_ITEMS_BASE = [
  { key: '/',           icon: <DashboardOutlined />,        label: '仪表盘' },
  { key: '/accounts',   icon: <TeamOutlined />,             label: '账号' },
  { key: '/scheduler',  icon: <ScheduleOutlined />,         label: '任务调度' },
  { key: '/campaigns',  icon: <SendOutlined />,             label: '广告投放' },
  { key: '/cs',         icon: <CustomerServiceOutlined />,  label: '智能客服' },
  { key: '/leads',      icon: <InboxOutlined />,            label: '人工接管' },
  { key: '/lead-candidates', icon: <TeamOutlined />,        label: '候选人池' },
  { key: '/chat-scripts', icon: <CustomerServiceOutlined />, label: '聊天剧本' },
  { key: '/settings',   icon: <SettingOutlined />,          label: '设置' },
];

const MENU_ITEM_ADMIN = {
  key: '/admin',
  icon: <CrownOutlined />,
  label: '管理面板',
};

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const user = readStoredUser();
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  const menuItems = useMemo(
    () => (isSuperAdmin ? [...MENU_ITEMS_BASE, MENU_ITEM_ADMIN] : MENU_ITEMS_BASE),
    [isSuperAdmin],
  );

  const selectedKey = useMemo(() => {
    const match = menuItems
      .map((i) => i.key)
      .filter((k) => (k === '/' ? location.pathname === '/' : location.pathname.startsWith(k)))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? '/';
  }, [location.pathname, menuItems]);

  const userMenuItems = [
    { key: 'profile', label: '个人资料', icon: <UserOutlined /> },
    { type: 'divider' as const },
    { key: 'logout', label: '登出', icon: <LogoutOutlined />, danger: true },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      localStorage.removeItem('telehubx:token');
      localStorage.removeItem('telehubx:user');
      navigate('/login');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          background: token.colorBgContainer,
          padding: '0 24px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Space size={4} style={{ marginRight: 8, flexShrink: 0 }}>
          <Title level={5} style={{ margin: 0, color: token.colorPrimary }}>
            TeleHubX
          </Title>
          <Text type="secondary" style={{ fontSize: 11 }}>
            v1.0
          </Text>
        </Space>

        <Menu
          mode="horizontal"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
          style={{ flex: 1, borderBottom: 'none', minWidth: 0, justifyContent: 'flex-start' }}
        />

        <Space size={12} style={{ flexShrink: 0 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {user.tenantName ?? 'default'}
          </Text>
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} trigger={['click']}>
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user.username ?? '未登录'}</span>
            </Button>
          </Dropdown>
        </Space>
      </Header>

      <Content
        style={{
          margin: 24,
          background: token.colorBgContainer,
          padding: 24,
          borderRadius: token.borderRadiusLG,
        }}
      >
        <Outlet />
      </Content>
    </Layout>
  );
}
