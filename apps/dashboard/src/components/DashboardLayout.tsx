import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Dropdown, Form, Input, Layout, Menu, Modal, Select, Space, Typography, message as antdMessage, theme } from 'antd';
import {
  CrownOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  GlobalOutlined,
  InboxOutlined,
  KeyOutlined,
  LogoutOutlined,
  ScheduleOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { LANG_OPTIONS, useI18n } from '../i18n';

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

function buildMenuItems(t: (k: string) => string) {
  return [
    { key: '/',                  icon: <DashboardOutlined />,        label: t('nav.dashboard') },
    { key: '/accounts',          icon: <TeamOutlined />,             label: t('nav.accounts') },
    { key: '/scheduler',         icon: <ScheduleOutlined />,         label: t('nav.scheduler') },
    { key: '/campaigns',         icon: <SendOutlined />,             label: t('nav.campaigns') },
    { key: '/cs',                icon: <CustomerServiceOutlined />,  label: t('nav.cs') },
    { key: '/leads',             icon: <InboxOutlined />,            label: t('cs.handoff') },
    { key: '/lead-candidates',   icon: <TeamOutlined />,             label: t('nav.candidates') },
    { key: '/discovered-groups', icon: <TeamOutlined />,             label: t('nav.discoveredGroups') },
    { key: '/settings',          icon: <SettingOutlined />,          label: t('nav.settings') },
  ];
}

function adminMenuItem(t: (k: string) => string) {
  return { key: '/admin', icon: <CrownOutlined />, label: t('nav.admin') };
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { lang, setLang, t } = useI18n();

  const user = readStoredUser();
  const isSuperAdmin = user.role?.toLowerCase() === 'super_admin';

  const menuItems = useMemo(() => {
    const base = buildMenuItems(t);
    return isSuperAdmin ? [...base, adminMenuItem(t)] : base;
  }, [isSuperAdmin, t, lang]);

  const selectedKey = useMemo(() => {
    const match = menuItems
      .map((i) => i.key)
      .filter((k) => (k === '/' ? location.pathname === '/' : location.pathname.startsWith(k)))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? '/';
  }, [location.pathname, menuItems]);

  const [pwModalOpen, setPwModalOpen] = useState(false);

  const userMenuItems = [
    { key: 'change-password', label: t('common.edit') + ' / ' + (lang === 'zh' ? '修改密码' : lang === 'en' ? 'Change Password' : lang === 'ms' ? 'Tukar Kata Laluan' : 'Đổi mật khẩu'), icon: <KeyOutlined /> },
    { type: 'divider' as const },
    { key: 'logout', label: t('nav.logout'), icon: <LogoutOutlined />, danger: true },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'change-password') {
      setPwModalOpen(true);
      return;
    }
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
          <Select
            size="small"
            variant="borderless"
            value={lang}
            onChange={(v) => setLang(v as any)}
            options={LANG_OPTIONS}
            style={{ width: 130 }}
            suffixIcon={<GlobalOutlined />}
          />
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

      <ChangePasswordModal
        open={pwModalOpen}
        onClose={() => setPwModalOpen(false)}
        onSuccess={() => {
          setPwModalOpen(false);
          // 改密成功后强制重新登录（旧 token 仍有效，但提示用户用新密码）
          antdMessage.success('密码已修改，请用新密码重新登录');
          setTimeout(() => {
            localStorage.removeItem('telehubx:token');
            localStorage.removeItem('telehubx:user');
            navigate('/login');
          }, 1500);
        }}
      />
    </Layout>
  );
}

// ── 修改密码 Modal ────────────────────────────────────────────────────
function ChangePasswordModal({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    let values: { oldPassword: string; newPassword: string; confirmPassword: string };
    try { values = await form.validateFields(); } catch { return; }
    if (values.newPassword !== values.confirmPassword) {
      antdMessage.error('两次输入的新密码不一致');
      return;
    }
    if (values.newPassword === values.oldPassword) {
      antdMessage.error('新密码不能与旧密码相同');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.changePassword(values.oldPassword, values.newPassword);
      form.resetFields();
      onSuccess();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '修改失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<Space><KeyOutlined /> 修改密码</Space>}
      onCancel={() => { form.resetFields(); onClose(); }}
      onOk={handleSubmit}
      okText="确认修改"
      cancelText="取消"
      confirmLoading={submitting}
      width={460}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, fontSize: 13 }}
        message="改密成功后会自动登出，请用新密码重新登录"
      />
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password placeholder="当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '至少 6 位' },
            { max: 64, message: '最长 64 位' },
          ]}
        >
          <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          rules={[{ required: true, message: '请再次输入新密码' }]}
        >
          <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
