import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  StopOutlined,
  SwapOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { aiApi, knowledgeApi, tenantsApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;

interface TenantBot {
  id: string;
  tenantId: string;
  botUsername: string;
  pollingOffset: number;
  isActive: boolean;
  lastError: string | null;
  lastPollAt: string | null;
  createdAt: string;
}

interface Tenant {
  id: string;
  name: string;
  plan: string;
  status: string;
}

type ReplyMode = 'off' | 'faq' | 'ai';

const MODE_CARDS: Array<{
  key: ReplyMode;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}> = [
  {
    key: 'off',
    icon: <StopOutlined style={{ fontSize: 28 }} />,
    title: '关闭',
    desc: '所有回复 100% 人工处理',
  },
  {
    key: 'faq',
    icon: <QuestionCircleOutlined style={{ fontSize: 28 }} />,
    title: 'FAQ 模式',
    desc: '只用 FAQ 匹配，命中就回，不命中转人工',
  },
  {
    key: 'ai',
    icon: <RobotOutlined style={{ fontSize: 28 }} />,
    title: 'AI 智能 + FAQ',
    desc: 'FAQ 优先，不命中时用 AI 兜底',
    badge: '推荐',
  },
];

export default function CsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bots, setBots] = useState<TenantBot[]>([]);
  const [kbCount, setKbCount] = useState(0);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const [registerVisible, setRegisterVisible] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<TenantBot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const activeBot = bots[0] ?? null;
  const currentMode: ReplyMode = !activeBot ? 'off' : 'ai';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantRes, kbRes, aiRes] = await Promise.all([
        tenantsApi.getDefault(),
        knowledgeApi.listKbs({ enabled: true }),
        aiApi.info().catch(() => null),
      ]);
      const t: Tenant = tenantRes.data;
      setTenant(t);
      setKbCount(Array.isArray(kbRes.data) ? kbRes.data.length : 0);
      if (aiRes?.data) {
        const providers: any[] = aiRes.data.providers ?? [];
        setAiConfigured(providers.some((p: any) => p.configured));
      }
      const botsRes = await tenantsApi.listBots(t.id);
      setBots(Array.isArray(botsRes.data) ? botsRes.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRegister = async (values: { token: string }) => {
    if (!tenant) return;
    setSubmitting(true);
    try {
      if (replaceTarget) {
        await tenantsApi.deleteBot(tenant.id, replaceTarget.id);
      }
      await tenantsApi.registerBot(tenant.id, values.token);
      antdMessage.success('Bot 注册成功，轮询已启动');
      setRegisterVisible(false);
      setReplaceTarget(null);
      form.resetFields();
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (bot: TenantBot) => {
    if (!tenant) return;
    try {
      if (bot.isActive) {
        await tenantsApi.stopBot(tenant.id, bot.id);
        antdMessage.success('已停止轮询');
      } else {
        await tenantsApi.startBot(tenant.id, bot.id);
        antdMessage.success('轮询已启动');
      }
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
    }
  };

  const handleDelete = async (bot: TenantBot) => {
    if (!tenant) return;
    Modal.confirm({
      title: '确认删除 Bot',
      content: `删除后将停止 @${bot.botUsername} 的轮询，客户消息将不再自动处理。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await tenantsApi.deleteBot(tenant.id, bot.id);
          antdMessage.success('Bot 已删除');
          void load();
        } catch (err: any) {
          antdMessage.error(err?.response?.data?.message ?? '删除失败');
        }
      },
    });
  };

  const openReplace = (bot: TenantBot) => {
    setReplaceTarget(bot);
    setRegisterVisible(true);
  };

  const botStatusBadge = activeBot
    ? activeBot.isActive
      ? <Badge status="processing" text="轮询中" />
      : <Badge status="default" text="已停止" />
    : <Badge status="error" text="未配置" />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <CustomerServiceOutlined style={{ marginRight: 8 }} />
            智能客服
          </Title>
          <Text type="secondary">配置 Telegram Bot 入口，设置自动回复模式</Text>
        </div>
        <Space>{botStatusBadge}</Space>
      </div>

      {/* Bot 配置 */}
      <Card
        title={<Space><ApiOutlined />Bot 配置</Space>}
        style={{ marginBottom: 16 }}
        extra={
          !activeBot && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterVisible(true)}>
              添加 Bot Token
            </Button>
          )
        }
        loading={loading}
      >
        {activeBot ? (
          <Row align="middle" gutter={16}>
            <Col flex={1}>
              <Space direction="vertical" size={2}>
                <Space>
                  <Text strong style={{ fontSize: 16 }}>@{activeBot.botUsername}</Text>
                  {activeBot.isActive
                    ? <Tag color="green" icon={<PlayCircleOutlined />}>轮询中</Tag>
                    : <Tag color="default" icon={<PauseCircleOutlined />}>已停止</Tag>}
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  已接收 {activeBot.pollingOffset} 条 update
                  {activeBot.lastPollAt && (
                    <> · 最后活动：{new Date(activeBot.lastPollAt).toLocaleTimeString()}</>
                  )}
                </Text>
                {activeBot.lastError && (
                  <Text type="danger" style={{ fontSize: 12 }}>
                    <WarningOutlined /> {activeBot.lastError}
                  </Text>
                )}
              </Space>
            </Col>
            <Col>
              <Space>
                <Button
                  icon={activeBot.isActive ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                  onClick={() => handleToggle(activeBot)}
                >
                  {activeBot.isActive ? '停止轮询' : '启动轮询'}
                </Button>
                <Tooltip title="更换 Bot Token（会先删除旧 Bot）">
                  <Button icon={<SwapOutlined />} onClick={() => openReplace(activeBot)}>
                    更换 Token
                  </Button>
                </Tooltip>
                <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(activeBot)} />
              </Space>
            </Col>
          </Row>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>
            <ApiOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
            <Paragraph type="secondary">
              尚未配置 Bot。前往 BotFather 创建 Bot 后，将 Token 填入此处。
            </Paragraph>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterVisible(true)}>
              添加 Bot Token
            </Button>
          </div>
        )}
      </Card>

      {/* 自动回复模式 */}
      <Card title="自动回复模式" style={{ marginBottom: 16 }}>
        <Row gutter={12}>
          {MODE_CARDS.map((m) => {
            const active = m.key === currentMode;
            return (
              <Col span={8} key={m.key}>
                <Card
                  style={{
                    textAlign: 'center',
                    cursor: 'default',
                    border: active ? '2px solid #1677ff' : '1px solid #f0f0f0',
                    background: active ? '#f0f7ff' : '#fafafa',
                    borderRadius: 8,
                  }}
                  styles={{ body: { padding: '20px 12px' } }}
                >
                  <div style={{ color: active ? '#1677ff' : '#999', marginBottom: 8 }}>
                    {active && <CheckCircleFilled style={{ position: 'absolute', top: 8, right: 8, color: '#1677ff' }} />}
                    {m.icon}
                  </div>
                  <Text strong style={{ color: active ? '#1677ff' : undefined }}>{m.title}</Text>
                  {m.badge && <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>{m.badge}</Tag>}
                  <Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    {m.desc}
                  </Paragraph>
                  {m.key === 'faq' && !aiConfigured && (
                    <Tag color="orange" style={{ fontSize: 11 }}>无需 AI Key</Tag>
                  )}
                  {m.key === 'ai' && !aiConfigured && active && (
                    <Tag color="orange" style={{ marginTop: 4, fontSize: 11 }}>需配置 AI Key</Tag>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="内部频率/夜间/去重规则全自动，无需配置（悬停查看）"
        />
      </Card>

      {/* 概览 + 知识库 + 高级设置 */}
      <Card>
        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <div>
                  <Row gutter={16} style={{ marginBottom: 24 }}>
                    <Col span={6}>
                      <Statistic title="知识库" value={kbCount} suffix="个" />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title="当前模式"
                        value={currentMode === 'ai' ? '智能' : '关闭'}
                        valueStyle={{ color: currentMode === 'ai' ? '#1677ff' : '#999' }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic title="每日上限" value={50} suffix="条/对话" />
                    </Col>
                    <Col span={6}>
                      <Statistic title="转人工触发词" value="13+" />
                    </Col>
                  </Row>

                  <Divider orientation="left" plain>客户消息怎么处理的</Divider>
                  <Space wrap size={8} align="center">
                    {[
                      { label: '客户私信 Bot', color: 'blue' },
                      null,
                      { label: '聚合 3s', color: 'default' },
                      null,
                      { label: 'FAQ 命中?', color: 'purple' },
                      null,
                      { label: 'AI 检索知识库', color: 'cyan' },
                      null,
                      { label: 'Guardrail 过滤', color: 'orange' },
                      null,
                      { label: '发送 / 转人工', color: 'green' },
                    ].map((item, i) =>
                      item
                        ? <Tag key={i} color={item.color} style={{ fontSize: 13, padding: '4px 10px' }}>{item.label}</Tag>
                        : <Text key={i} type="secondary">→</Text>
                    )}
                  </Space>
                  <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                    需要人工处理的对话会出现在「Leads」页的待处理列表
                  </Paragraph>
                </div>
              ),
            },
            {
              key: 'knowledge',
              label: '知识库',
              children: (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <Text type="secondary">知识库管理请前往</Text>
                  <Button type="link" href="/knowledge">Knowledge 页面</Button>
                </div>
              ),
            },
            {
              key: 'advanced',
              label: '高级设置',
              children: (
                <div style={{ padding: '16px 0' }}>
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    <Card size="small">
                      <Space>
                        <ClockCircleOutlined />
                        <Text>频率限制：每次回复最小间隔 3s（<Text code>AI_MIN_INTERVAL_MS</Text>）</Text>
                      </Space>
                    </Card>
                    <Card size="small">
                      <Space>
                        <ClockCircleOutlined />
                        <Text>每日上限：每对话每日最多回复 50 条（<Text code>AI_DAILY_LIMIT_PER_CHAT</Text>）</Text>
                      </Space>
                    </Card>
                    <Card size="small">
                      <Space>
                        <WarningOutlined style={{ color: 'orange' }} />
                        <Text>转人工关键词：通过 <Text code>AI_HANDOFF_KEYWORDS</Text> 在 .env 中配置（逗号分隔）</Text>
                      </Space>
                    </Card>
                    <Alert
                      type="warning"
                      showIcon
                      message="修改以上配置需编辑服务端 .env 文件后执行 pm2 restart telehubx-server"
                    />
                  </Space>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 注册 / 更换 Bot Token Modal */}
      <Modal
        title={replaceTarget ? `更换 @${replaceTarget.botUsername} 的 Token` : '添加 Bot Token'}
        open={registerVisible}
        onCancel={() => { setRegisterVisible(false); setReplaceTarget(null); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        {replaceTarget && (
          <Alert
            type="warning"
            showIcon
            message="更换 Token 会先删除旧 Bot 记录并停止轮询，然后注册新 Bot。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          前往 <Text code>@BotFather</Text> 发送 <Text code>/newbot</Text> 或 <Text code>/token</Text>，
          复制 Bot Token 后填入下方。系统会自动验证并开始长轮询。
        </Paragraph>
        <Form form={form} layout="vertical" onFinish={handleRegister}>
          <Form.Item
            name="token"
            label="Bot Token"
            rules={[
              { required: true, message: '请输入 Bot Token' },
              { pattern: /^\d+:[A-Za-z0-9_-]{35,}$/, message: 'Token 格式不正确（格式：数字:字母数字串）' },
            ]}
          >
            <Input.Password
              placeholder="1234567890:AAF..."
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setRegisterVisible(false); setReplaceTarget(null); form.resetFields(); }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {replaceTarget ? '更换并启动' : '注册并启动'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
