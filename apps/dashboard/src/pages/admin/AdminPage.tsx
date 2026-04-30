import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Result,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  CrownOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

function readUserRole(): string {
  try {
    const raw = localStorage.getItem('telehubx:user');
    if (!raw) return 'OPERATOR';
    return JSON.parse(raw).role ?? 'OPERATOR';
  } catch {
    return 'OPERATOR';
  }
}

export default function AdminPage() {
  const [role, setRole] = useState<string>('OPERATOR');

  useEffect(() => {
    setRole(readUserRole());
  }, []);

  if (role !== 'SUPER_ADMIN') {
    return (
      <Result
        status="403"
        title="403"
        subTitle="你没有访问管理面板的权限。该页仅 SaaS 平台管理员可见。"
        extra={<Button type="primary" href="/">回到仪表盘</Button>}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CrownOutlined style={{ marginRight: 8, color: '#faad14' }} />
          管理面板
          <Tag color="gold" style={{ marginLeft: 12, fontSize: 11 }}>SaaS Admin</Tag>
        </Title>
        <Text type="secondary">公司层级控制台 · 多租户管理 · License 签发 · 全局默认配置</Text>
      </div>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="前端骨架版（mock 数据）"
        description="多租户后端隔离、License 签发服务、全局默认 AI Key 管理待立项。"
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="租户总数"     value={1}  prefix={<TeamOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="活跃 License" value={1}  prefix={<SafetyCertificateOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="即将到期"     value={0}  valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已暂停"        value={0}  valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      <Card>
        <Tabs
          defaultActiveKey="tenants"
          items={[
            {
              key: 'tenants',
              label: <span><TeamOutlined /> 租户管理</span>,
              children: (
                <div>
                  <Space style={{ marginBottom: 16 }}>
                    <Button type="primary">+ 新建租户</Button>
                    <Button>导出 CSV</Button>
                  </Space>
                  <Table
                    dataSource={[
                      { id: '1', name: 'default', plan: 'BASIC', status: 'ACTIVE', signedAt: '2026-04-30', expiresAt: '2027-04-30', maxAccounts: 10, currentAccounts: 1 },
                    ]}
                    rowKey="id"
                    size="small"
                    columns={[
                      { title: '租户名称', dataIndex: 'name' },
                      { title: '套餐', dataIndex: 'plan', render: (p: string) => <Tag color="blue">{p}</Tag> },
                      { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color="green">{s}</Tag> },
                      { title: '签署时间', dataIndex: 'signedAt' },
                      { title: '到期时间', dataIndex: 'expiresAt' },
                      { title: '账号配额', render: (_, r) => `${r.currentAccounts}/${r.maxAccounts}` },
                      { title: '操作', render: () => <Space><Button size="small" type="text">详情</Button><Button size="small" type="text" danger>暂停</Button></Space> },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'licenses',
              label: <span><SafetyCertificateOutlined /> License 签发</span>,
              children: (
                <div>
                  <Space style={{ marginBottom: 16 }}>
                    <Button type="primary">+ 签发新 License</Button>
                    <Button>批量导入</Button>
                  </Space>
                  <Empty description="License 列表（待对接后端 /licenses 路由）" style={{ padding: 40 }} />
                </div>
              ),
            },
            {
              key: 'platform-ai',
              label: <span><KeyOutlined /> 全局 AI 默认</span>,
              children: (
                <div>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="平台兜底 AI Key（公司付费）"
                    description="用于 FAQ 自动生成、文案优化、翻译等内部工具，租户没自配 key 时也可作为客户聊天兜底。当前在服务端 .env 中通过 PLATFORM_OPENAI_API_KEY / PLATFORM_DEEPSEEK_API_KEY 配置。"
                  />
                  <Empty description="后续从 .env 迁移到此可视化配置（含使用量/账单统计）" style={{ padding: 40 }} />
                </div>
              ),
            },
            {
              key: 'system',
              label: <span><ToolOutlined /> 系统监控</span>,
              children: (
                <Empty description="VPS 心跳 / License 校验 / 全局任务队列状态" style={{ padding: 40 }} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
