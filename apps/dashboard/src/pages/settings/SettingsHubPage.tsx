import { useState } from 'react';
import { Card, Col, Drawer, Row, Space, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  BookOutlined,
  CrownOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';

import AiSettingsPage from '../ai/AiSettingsPage';
import ProxiesPage from '../proxies/ProxiesPage';
import KnowledgePage from '../knowledge/KnowledgePage';
import WarmupPage from '../warmup/WarmupPage';
import AssetsPage from '../assets/AssetsPage';
import GroupsPage from '../groups/GroupsPage';

const { Title, Text, Paragraph } = Typography;

type SettingKey = 'ai' | 'proxies' | 'knowledge' | 'warmup' | 'assets' | 'groups';

interface SettingItem {
  key: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  drawerKey?: SettingKey;
  badge?: string;
  disabled?: boolean;
  drawerWidth?: number;
}

const SETTING_ITEMS: SettingItem[] = [
  {
    key: 'ai',
    icon: <ApiOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
    title: 'AI 配置',
    desc: '租户自有 AI Key（客服聊天）+ 平台兜底设置 + AI 营销人设',
    drawerKey: 'ai',
    drawerWidth: 760,
  },
  {
    key: 'proxies',
    icon: <GlobalOutlined style={{ fontSize: 28, color: '#52c41a' }} />,
    title: '代理管理',
    desc: 'SOCKS5 / HTTP 代理池，账号绑定一对一固定 IP',
    drawerKey: 'proxies',
    drawerWidth: 900,
  },
  {
    key: 'knowledge',
    icon: <BookOutlined style={{ fontSize: 28, color: '#722ed1' }} />,
    title: '知识库',
    desc: 'KB / FAQ / 保留实体；产品资讯、公司介绍、产品 FAQ 按租户独立管理',
    drawerKey: 'knowledge',
    drawerWidth: 1000,
  },
  {
    key: 'warmup',
    icon: <RocketOutlined style={{ fontSize: 28, color: '#fa8c16' }} />,
    title: '账号养号',
    desc: 'P0–P4 渐进养号配置，7 天周期自动推进',
    drawerKey: 'warmup',
    drawerWidth: 900,
  },
  {
    key: 'assets',
    icon: <DatabaseOutlined style={{ fontSize: 28, color: '#a0d911' }} />,
    title: '素材库',
    desc: '图片 / 视频 / 语音 / 文档 / 文本片段，媒体任务从这里随机抽取',
    drawerKey: 'assets',
    drawerWidth: 1000,
  },
  {
    key: 'groups',
    icon: <TeamOutlined style={{ fontSize: 28, color: '#fa541c' }} />,
    title: '群组管理',
    desc: '自建群 / 自有群 / 公开群登记，ChatScript 等任务的运行场地',
    drawerKey: 'groups',
    drawerWidth: 900,
  },
  {
    key: 'license',
    icon: <SafetyCertificateOutlined style={{ fontSize: 28, color: '#13c2c2' }} />,
    title: 'License',
    desc: '当前激活状态、签署时间、续期；首次激活在登录页输入 key',
    badge: '即将上线',
    disabled: true,
  },
  {
    key: 'users',
    icon: <TeamOutlined style={{ fontSize: 28, color: '#eb2f96' }} />,
    title: '用户管理',
    desc: '租户内的子账号 / 角色 / 权限',
    badge: '即将上线',
    disabled: true,
  },
  {
    key: 'system',
    icon: <ToolOutlined style={{ fontSize: 28, color: '#8c8c8c' }} />,
    title: '系统维护',
    desc: '备份 / 恢复 / 日志 / 健康检查',
    badge: '即将上线',
    disabled: true,
  },
];

const DRAWER_CONTENT: Record<SettingKey, React.ReactNode> = {
  ai:        <AiSettingsPage />,
  proxies:   <ProxiesPage />,
  knowledge: <KnowledgePage />,
  warmup:    <WarmupPage />,
  assets:    <AssetsPage />,
  groups:    <GroupsPage />,
};

const DRAWER_TITLE: Record<SettingKey, string> = {
  ai:        'AI 配置',
  proxies:   '代理管理',
  knowledge: '知识库',
  warmup:    '账号养号',
  assets:    '素材库',
  groups:    '群组管理',
};

export default function SettingsHubPage() {
  const [activeKey, setActiveKey] = useState<SettingKey | null>(null);

  const activeItem = SETTING_ITEMS.find(i => i.drawerKey === activeKey);
  const drawerWidth = activeItem?.drawerWidth ?? 800;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8 }} />
          设置中心
        </Title>
        <Text type="secondary">点击任一卡片在弹窗中配置</Text>
      </div>

      <Row gutter={[16, 16]}>
        {SETTING_ITEMS.map((item) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
            <Card
              hoverable={!item.disabled}
              onClick={() => {
                if (!item.disabled && item.drawerKey) {
                  setActiveKey(item.drawerKey);
                }
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
