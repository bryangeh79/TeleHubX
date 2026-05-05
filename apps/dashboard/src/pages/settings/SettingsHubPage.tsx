import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Drawer, Row, Space, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  BookOutlined,
  CrownOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  RocketOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';

import AiSettingsPage from '../ai/AiSettingsPage';
import ProxiesPage from '../proxies/ProxiesPage';
import KnowledgePage from '../knowledge/KnowledgePage';
import WarmupPage from '../warmup/WarmupPage';
import AssetsPage from '../assets/AssetsPage';
import GroupsPage from '../groups/GroupsPage';
import LanguageSettingsPage from './LanguageSettingsPage';
import { useT } from '../../i18n';

const { Title, Text, Paragraph } = Typography;

type SettingKey = 'ai' | 'proxies' | 'knowledge' | 'warmup' | 'assets' | 'groups' | 'language';

interface SettingItem {
  key: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  drawerKey?: SettingKey;
  navigateTo?: string;          // 跳转外部路由（如 /settings/maintenance）
  badge?: string;
  disabled?: boolean;
  drawerWidth?: number;
}

function buildSettingItems(t: (k: string) => string): SettingItem[] {
  return [
    {
      key: 'ai',
      icon: <ApiOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
      title: t('settings.card.ai'),
      desc: t('settings.card.ai.desc'),
      drawerKey: 'ai',
      drawerWidth: 760,
    },
    {
      key: 'proxies',
      icon: <GlobalOutlined style={{ fontSize: 28, color: '#52c41a' }} />,
      title: t('settings.card.proxies'),
      desc: t('settings.card.proxies.desc'),
      drawerKey: 'proxies',
      drawerWidth: 900,
    },
    {
      key: 'knowledge',
      icon: <BookOutlined style={{ fontSize: 28, color: '#722ed1' }} />,
      title: t('settings.card.knowledge'),
      desc: t('settings.card.knowledge.desc'),
      drawerKey: 'knowledge',
      drawerWidth: 1000,
    },
    {
      key: 'warmup',
      icon: <RocketOutlined style={{ fontSize: 28, color: '#fa8c16' }} />,
      title: t('settings.card.warmup'),
      desc: t('settings.card.warmup.desc'),
      drawerKey: 'warmup',
      drawerWidth: 900,
    },
    {
      key: 'assets',
      icon: <DatabaseOutlined style={{ fontSize: 28, color: '#a0d911' }} />,
      title: t('settings.card.assets'),
      desc: t('settings.card.assets.desc'),
      drawerKey: 'assets',
      drawerWidth: 1000,
    },
    {
      key: 'groups',
      icon: <TeamOutlined style={{ fontSize: 28, color: '#fa541c' }} />,
      title: t('settings.card.groups'),
      desc: t('settings.card.groups.desc'),
      drawerKey: 'groups',
      drawerWidth: 900,
    },
    {
      key: 'language',
      icon: <GlobalOutlined style={{ fontSize: 28, color: '#13c2c2' }} />,
      title: t('settings.card.language'),
      desc: t('settings.card.language.desc'),
      drawerKey: 'language',
      drawerWidth: 720,
    },
    {
      key: 'maintenance',
      icon: <ToolOutlined style={{ fontSize: 28, color: '#8c8c8c' }} />,
      title: t('settings.card.maintenance'),
      desc: t('settings.card.maintenance.desc'),
      navigateTo: '/settings/maintenance',
    },
  ];
}

const DRAWER_CONTENT: Record<SettingKey, React.ReactNode> = {
  ai:        <AiSettingsPage />,
  proxies:   <ProxiesPage />,
  knowledge: <KnowledgePage />,
  warmup:    <WarmupPage />,
  assets:    <AssetsPage />,
  groups:    <GroupsPage />,
  language:  <LanguageSettingsPage />,
};

function buildDrawerTitle(t: (k: string) => string): Record<SettingKey, string> {
  return {
    ai:        t('settings.card.ai'),
    proxies:   t('settings.card.proxies'),
    knowledge: t('settings.card.knowledge'),
    warmup:    t('settings.card.warmup'),
    assets:    t('settings.card.assets'),
    groups:    t('settings.card.groups'),
    language:  t('settings.card.language'),
  };
}

export default function SettingsHubPage() {
  const t = useT();
  const SETTING_ITEMS = buildSettingItems(t);
  const DRAWER_TITLE = buildDrawerTitle(t);
  const [activeKey, setActiveKey] = useState<SettingKey | null>(null);
  const navigate = useNavigate();

  const activeItem = SETTING_ITEMS.find(i => i.drawerKey === activeKey);
  const drawerWidth = activeItem?.drawerWidth ?? 800;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8 }} />
          {t('settings.title')}
        </Title>
        <Text type="secondary">{t('settings.subtitle')}</Text>
      </div>

      <Row gutter={[16, 16]}>
        {SETTING_ITEMS.map((item) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
            <Card
              hoverable={!item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (item.navigateTo) navigate(item.navigateTo);
                else if (item.drawerKey) setActiveKey(item.drawerKey);
              }}
              style={{
                height: '100%',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.6 : 1,
                transition: 'box-shadow 0.2s',
              }}
              styles={{ body: { padding: 20 } }}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  {item.icon}
                  {item.badge && <Tag color="orange">{item.badge}</Tag>}
                </Space>
                <Text strong style={{ fontSize: 16 }}>{item.title}</Text>
                <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                  {item.desc}
                </Paragraph>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Drawer
        open={activeKey !== null}
        onClose={() => setActiveKey(null)}
        title={activeKey ? DRAWER_TITLE[activeKey] : ''}
        width={drawerWidth}
        destroyOnClose={false}
        styles={{
          body: { padding: '16px 24px', overflowY: 'auto' },
          header: { borderBottom: '1px solid #f0f0f0' },
        }}
      >
        {activeKey && DRAWER_CONTENT[activeKey]}
      </Drawer>
    </div>
  );
}
