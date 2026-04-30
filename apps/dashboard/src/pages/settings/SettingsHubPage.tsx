import { Card, Col, Row, Space, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  BookOutlined,
  CloudServerOutlined,
  CrownOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  KeyOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Text, Paragraph } = Typography;

interface SettingItem {
  key: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  to?: string;
  external?: boolean;
  badge?: string;
  disabled?: boolean;
}

const SETTING_ITEMS: SettingItem[] = [
  {
    key: 'ai',
    icon: <ApiOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
    title: 'AI 配置',
    desc: '租户自有 AI Key（客服聊天）+ 平台兜底状态',
    to: '/ai',
  },
  {
    key: 'proxies',
    icon: <GlobalOutlined style={{ fontSize: 28, color: '#52c41a' }} />,
    title: '代理管理',
    desc: 'SOCKS5 / HTTP 代理池，账号绑定一对一固定 IP',
    to: '/proxies',
  },
  {
    key: 'knowledge',
    icon: <BookOutlined style={{ fontSize: 28, color: '#722ed1' }} />,
    title: '知识库',
    desc: 'KB / FAQ / 保留实体；也可在「智能客服」内嵌入访问',
    to: '/knowledge',
  },
  {
    key: 'warmup',
    icon: <RocketOutlined style={{ fontSize: 28, color: '#fa8c16' }} />,
    title: '账号养号',
    desc: 'P0–P4 渐进养号配置；建议改在 Accounts 详情页 tab',
    to: '/warmup',
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
    key: 'assets',
    icon: <DatabaseOutlined style={{ fontSize: 28, color: '#a0d911' }} />,
    title: '资源库',
    desc: '广告素材 / 图片 / 视频 / 语音 / 文件',
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

export default function SettingsHubPage() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8 }} />
          设置中心
        </Title>
        <Text type="secondary">租户级配置入口（合并自原 AI/Proxies/Knowledge/Warmup 等独立页）</Text>
      </div>

      <Row gutter={[16, 16]}>
        {SETTING_ITEMS.map((item) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
            <Card
              hoverable={!item.disabled}
              onClick={() => !item.disabled && item.to && navigate(item.to)}
              style={{
                height: '100%',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.6 : 1,
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
    </div>
  );
}
