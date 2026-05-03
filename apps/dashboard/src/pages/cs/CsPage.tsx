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
  AppstoreOutlined,
  BankOutlined,
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
import CompanyInfoWizard from '../ai/CompanyInfoWizard';
import ProductSetupWizard from '../ai/ProductSetupWizard';
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

interface TenantSettings {
  tenantId: string;
  replyMode: ReplyMode;
  dailyReplyLimit: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

type ReplyMode = 'off' | 'faq' | 'smart';

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
    key: 'smart',
    icon: <RobotOutlined style={{ fontSize: 28 }} />,
    title: 'AI 智能 + FAQ',
    desc: 'FAQ 优先，不命中时用 AI 兜底',
    badge: '推荐',
  },
];

export default function CsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bots, setBots] = useState<TenantBot[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [kbCount, setKbCount] = useState(0);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  // 已配置的公司资料 + 产品列表
  const [companyKb, setCompanyKb] = useState<any | null>(null);
  const [productKbs, setProductKbs] = useState<any[]>([]);
  const [productFaqCounts, setProductFaqCounts] = useState<Record<string, number>>({});

  const [companyWizardOpen, setCompanyWizardOpen] = useState(false);
  const [productWizardOpen, setProductWizardOpen] = useState(false);
  const [registerVisible, setRegisterVisible] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<TenantBot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const activeBot = bots[0] ?? null;
  const currentMode: ReplyMode = settings?.replyMode ?? 'smart';

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
      const allKbs = Array.isArray(kbRes.data) ? kbRes.data : [];
      setKbCount(allKbs.length);
      // 拆分公司资料 + 产品列表
      const company = allKbs.find((k: any) => k.type === 'company' && (!t.id || k.tenantId === t.id));
      const products = allKbs.filter((k: any) => k.type === 'product' && (!t.id || k.tenantId === t.id));
      setCompanyKb(company ?? null);
      setProductKbs(products);
      // 异步拉每个产品的 FAQ 数量
      Promise.all(products.map((p: any) =>
        knowledgeApi.listFaqs({ kbId: p.id }).then(r => [p.id, (r.data ?? []).length] as const).catch(() => [p.id, 0] as const)
      )).then((entries) => {
        setProductFaqCounts(Object.fromEntries(entries));
      });
      if (aiRes?.data) {
        const providers: any[] = aiRes.data.providers ?? [];
        setAiConfigured(providers.some((p: any) => p.configured));
      }
      const [botsRes, settingsRes] = await Promise.all([
        tenantsApi.listBots(t.id),
        tenantsApi.getSettings(t.id),
      ]);
      setBots(Array.isArray(botsRes.data) ? botsRes.data : []);
      setSettings(settingsRes.data ?? null);
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

  const handleDiagnose = async (bot: TenantBot) => {
    if (!tenant) return;
    try {
      const res = await tenantsApi.webhookInfo(tenant.id, bot.id);
      const info = res.data;
      const hasWebhook = !!info.url;
      Modal.confirm({
        icon: hasWebhook ? <WarningOutlined style={{ color: '#fa8c16' }} /> : <CheckCircleFilled style={{ color: '#52c41a' }} />,
        title: hasWebhook ? '检测到 webhook 占用！' : 'Bot 状态正常',
        content: (
          <div style={{ marginTop: 12 }}>
            {hasWebhook ? (
              <div>
                <Paragraph>
                  当前有第三方 webhook 在拦截消息，所以 TeleHubX 的 long-polling 拿不到客户消息。
                </Paragraph>
                <Paragraph>
                  <Text strong>Webhook URL：</Text>
                  <br />
                  <Text code style={{ wordBreak: 'break-all', fontSize: 11 }}>{info.url}</Text>
                </Paragraph>
                <Paragraph type="secondary" style={{ fontSize: 12 }}>
                  积压消息：{info.pendingUpdateCount} 条
                  {info.lastErrorMessage && <><br />最后错误：{info.lastErrorMessage}</>}
                </Paragraph>
                <Alert
                  type="info"
                  showIcon
                  message="点「清除 Webhook」后，所有消息会立即流向 TeleHubX，「人工接管」页就能实时收到对话。"
                />
              </div>
            ) : (
              <div>
                <Paragraph>没有 webhook 占用，long-polling 应该正常工作。</Paragraph>
                <Paragraph type="secondary" style={{ fontSize: 12 }}>
                  如果客户发消息后「人工接管」页仍然没动静，请检查：
                  <ul style={{ marginTop: 6 }}>
                    <li>客户是否真的在和这个 Bot（@{bot.botUsername}）聊天</li>
                    <li>Bot 是否处于 isActive=true 状态（看上方 tag）</li>
                    <li>Server 日志：<Text code>pm2 logs telehubx-server</Text></li>
                  </ul>
                </Paragraph>
              </div>
            )}
          </div>
        ),
        okText: hasWebhook ? '清除 Webhook' : '关闭',
        cancelText: hasWebhook ? '取消' : undefined,
        cancelButtonProps: { style: { display: hasWebhook ? undefined : 'none' } },
        onOk: hasWebhook
          ? async () => {
              try {
                const r = await tenantsApi.clearWebhook(tenant.id, bot.id);
                if (r.data?.ok) {
                  antdMessage.success('Webhook 已清除，TeleHubX 现在独占消息流');
                  void load();
                } else {
                  antdMessage.error(`清除失败: ${r.data?.description ?? 'unknown'}`);
                }
              } catch (err: any) {
                antdMessage.error(err?.response?.data?.message ?? '清除失败');
              }
            }
          : undefined,
      });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '诊断失败');
    }
  };

  const performModeChange = async (mode: ReplyMode) => {
    if (!tenant) return;
    setSavingMode(true);
    try {
      const res = await tenantsApi.updateSettings(tenant.id, { replyMode: mode });
      setSettings(res.data);
      const label = mode === 'off' ? '关闭' : mode === 'faq' ? 'FAQ 模式' : 'AI 智能 + FAQ';
      antdMessage.success(`已切换到 ${label}`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '切换失败');
    } finally {
      setSavingMode(false);
    }
  };

  const handleModeChange = (mode: ReplyMode) => {
    if (!tenant || mode === currentMode || savingMode) return;

    // Smart 模式无 key → 阻断弹窗，引导去配置
    if (mode === 'smart' && !aiConfigured) {
      Modal.warning({
        title: '无法启用 AI 智能模式',
        content: (
          <div>
            <Paragraph>启用 AI 智能模式需要先配置至少一个 AI Provider 的 API Key。</Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              请前往 <Text strong>AI Settings</Text> 页面查看，并在服务端 <Text code>.env</Text> 中配置
              <Text code>OPENAI_API_KEY</Text> / <Text code>DEEPSEEK_API_KEY</Text> / <Text code>GEMINI_API_KEY</Text> 后重启 telehubx-server。
            </Paragraph>
          </div>
        ),
        okText: '前往 AI Settings',
        onOk: () => { window.location.href = '/ai'; },
      });
      return;
    }

    const dialogs: Record<ReplyMode, { title: string; content: React.ReactNode; okText: string; okType?: 'primary' | 'danger' }> = {
      off: {
        title: '确认关闭自动回复？',
        content: (
          <Paragraph>
            关闭后，客户回复广告时系统 <Text strong style={{ color: '#cf1322' }}>100% 不会自动处理</Text>，
            全部留给人工。广告跑了也没人自动回，确认？
          </Paragraph>
        ),
        okText: '确定关闭',
        okType: 'danger',
      },
      faq: {
        title: '确认启用 FAQ 模式？',
        content: (
          <Paragraph>
            只用 FAQ 匹配客户消息，命中就回，没命中的自动转「人工接管」。
            <br />
            <Text type="secondary">无需配置 AI Key · 免费使用</Text>
          </Paragraph>
        ),
        okText: '确定启用',
        okType: 'primary',
      },
      smart: {
        title: '确认启用 AI 智能 + FAQ？',
        content: (
          <div>
            <Paragraph>
              FAQ 优先，命中就回；没命中时调用 AI 兜底回复。
            </Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              该模式将消耗你配置的 AI Provider Token（OpenAI/DeepSeek/Gemini）。
              开启后客户消息进入 Bot 会自动回复，对所有 cs 与 ad 账号生效。
            </Paragraph>
          </div>
        ),
        okText: '确定启用',
        okType: 'primary',
      },
    };

    const cfg = dialogs[mode];
    Modal.confirm({
      title: cfg.title,
      content: cfg.content,
      okText: cfg.okText,
      okType: cfg.okType,
      cancelText: '取消',
      onOk: () => performModeChange(mode),
    });
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
        <Space size={8}>
          <Button
            size="large"
            icon={<BankOutlined />}
            onClick={() => setCompanyWizardOpen(true)}
            style={{ fontWeight: 500 }}
          >
            设置公司资讯
          </Button>
          <Button
            size="large"
            type="primary"
            icon={<AppstoreOutlined />}
            onClick={() => setProductWizardOpen(true)}
            style={{ fontWeight: 500 }}
          >
            设置产品
          </Button>
          {botStatusBadge}
        </Space>
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
                  <Typography.Link
                    href={`https://t.me/${activeBot.botUsername}`}
                    target="_blank"
                    strong
                    style={{ fontSize: 16 }}
                  >
                    @{activeBot.botUsername}
                  </Typography.Link>
                  {activeBot.isActive
                    ? <Tag color="green" icon={<PlayCircleOutlined />}>轮询中</Tag>
                    : <Tag color="default" icon={<PauseCircleOutlined />}>已停止</Tag>}
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Bot 记录 ID: <Text code copyable={{ text: activeBot.id }} style={{ fontSize: 11 }}>{activeBot.id.slice(0, 8)}…</Text>
                  {' · '}已接收 {activeBot.pollingOffset} 条 update
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
                <Tooltip title="检查 webhook 是否被其他系统占用，并可一键清除">
                  <Button icon={<WarningOutlined />} onClick={() => handleDiagnose(activeBot)}>
                    诊断
                  </Button>
                </Tooltip>
                <Tooltip title="切换到不同的 Bot（删除当前记录，注册新 Bot 的 Token）">
                  <Button icon={<SwapOutlined />} onClick={() => openReplace(activeBot)}>
                    切换 Bot
                  </Button>
                </Tooltip>
                <Tooltip title="删除 Bot 记录">
                  <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(activeBot)} />
                </Tooltip>
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
      <Card title="自动回复模式" style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={12}>
          {MODE_CARDS.map((m) => {
            const active = m.key === currentMode;
            const aiBlocked = m.key === 'smart' && !aiConfigured;
            return (
              <Col span={8} key={m.key}>
                <Card
                  hoverable={!savingMode}
                  onClick={() => handleModeChange(m.key)}
                  style={{
                    textAlign: 'center',
                    cursor: savingMode ? 'wait' : 'pointer',
                    border: active ? '2px solid #1677ff' : '1px solid #f0f0f0',
                    background: active ? '#f0f7ff' : '#fafafa',
                    borderRadius: 8,
                    opacity: aiBlocked && !active ? 0.7 : 1,
                    position: 'relative',
                  }}
                  styles={{ body: { padding: '20px 12px' } }}
                >
                  {active && (
                    <CheckCircleFilled
                      style={{ position: 'absolute', top: 8, right: 8, color: '#1677ff', fontSize: 16 }}
                    />
                  )}
                  <div style={{ color: active ? '#1677ff' : '#999', marginBottom: 8 }}>
                    {m.icon}
                  </div>
                  <Text strong style={{ color: active ? '#1677ff' : undefined }}>{m.title}</Text>
                  {m.badge && <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>{m.badge}</Tag>}
                  <Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    {m.desc}
                  </Paragraph>
                  {m.key === 'faq' && (
                    <Tag color="green" style={{ fontSize: 11 }}>无需 AI Key</Tag>
                  )}
                  {m.key === 'smart' && (
                    <Tag color={aiConfigured ? 'blue' : 'orange'} style={{ fontSize: 11 }}>
                      {aiConfigured ? '已配 AI Key' : '需配 AI Key'}
                    </Tag>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
        {!aiConfigured && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="未配置 AI API Key"
            description="请前往 AI Settings 页面，在服务端 .env 中配置 OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY 后重启 telehubx-server，再启用「AI 智能 + FAQ」模式。"
            action={<Button size="small" type="link" href="/ai">前往 AI Settings</Button>}
          />
        )}
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="模式切换立即生效。进入 Leads 页的对话被人工接管后，AI 永远不会插嘴。"
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
                        value={currentMode === 'smart' ? '智能 + FAQ' : currentMode === 'faq' ? 'FAQ Only' : '关闭'}
                        valueStyle={{
                          color: currentMode === 'smart' ? '#1677ff' : currentMode === 'faq' ? '#52c41a' : '#999',
                          fontSize: 18,
                        }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic title="每日上限" value={settings?.dailyReplyLimit ?? 50} suffix="条/对话" />
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
              label: <span>知识库 <Tag color="blue" style={{ marginLeft: 4 }}>{(companyKb ? 1 : 0) + productKbs.length}</Tag></span>,
              children: (
                <div style={{ padding: '16px 0' }}>
                  {/* 公司资料卡 */}
                  <Card size="small" style={{ marginBottom: 12 }}
                    title={<Space><BankOutlined style={{ color: '#1677ff' }} /><Text strong>公司资料</Text>{companyKb ? <Tag color="success">已配置</Tag> : <Tag>未配置</Tag>}</Space>}
                    extra={
                      <Button size="small" icon={companyKb ? <RobotOutlined /> : <PlusOutlined />}
                        onClick={() => setCompanyWizardOpen(true)}>
                        {companyKb ? '编辑' : '设置'}
                      </Button>
                    }
                  >
                    {companyKb ? (() => {
                      let info: any = {};
                      try { info = JSON.parse(companyKb.description ?? '{}'); } catch {}
                      const contactCount = (info.contacts ?? []).filter((c: any) => c.value).length;
                      return (
                        <div>
                          <Text strong style={{ fontSize: 14 }}>{info.companyName ?? companyKb.name.replace(' - 公司资料', '')}</Text>
                          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{info.industry}</Text>
                          <Paragraph style={{ fontSize: 12, color: '#666', margin: '6px 0', whiteSpace: 'pre-wrap' }}
                            ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}>
                            {companyKb.goalPrompt || info.about || '—'}
                          </Paragraph>
                          <Space size={4} wrap>
                            {contactCount > 0 && <Tag color="green">{contactCount} 个联系方式</Tag>}
                            {info.email && <Tag color="cyan">📧 {info.email}</Tag>}
                            {info.website && <Tag color="purple">🌐 已配置网站</Tag>}
                            {info.hoursFrom && <Tag>⏰ {info.hoursFrom}-{info.hoursTo} {info.timeFrom}-{info.timeTo}</Tag>}
                          </Space>
                        </div>
                      );
                    })() : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        填写公司基本信息 + 联系方式 + 营业时间，Bot 会用来回答客户问公司相关的问题。
                      </Text>
                    )}
                  </Card>

                  {/* 产品列表卡 */}
                  <Card size="small"
                    title={<Space><span style={{ fontSize: 14 }}>📦</span><Text strong>产品资料</Text>{productKbs.length > 0 && <Tag color="success">已配置 {productKbs.length} 个</Tag>}</Space>}
                    extra={
                      <Button size="small" type="primary" icon={<PlusOutlined />}
                        onClick={() => setProductWizardOpen(true)}>
                        管理产品
                      </Button>
                    }
                  >
                    {productKbs.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        点「管理产品」添加产品 → 上传介绍书 → AI 一键生成 30-50 条 FAQ + 销售目标。
                        Bot 会优先用产品 FAQ 回答客户。
                      </Text>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {productKbs.map((p: any) => {
                          let info: any = {};
                          try { info = JSON.parse(p.description ?? '{}'); } catch {}
                          const faqCount = productFaqCounts[p.id] ?? '...';
                          return (
                            <div key={p.id} style={{
                              border: '1px solid #f0f0f0', borderRadius: 6,
                              padding: '8px 12px', background: '#fafafa',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Text strong style={{ fontSize: 13 }}>
                                  {info.productName ?? p.name.replace(' - 产品资料', '')}
                                </Text>
                                <Space size={4} wrap style={{ marginLeft: 8 }}>
                                  {info.price && <Tag color="orange" style={{ fontSize: 10 }}>{info.price}</Tag>}
                                  <Tag color="blue" style={{ fontSize: 10 }}>{faqCount} 条 FAQ</Tag>
                                  {p.goalPrompt && <Tag color="purple" style={{ fontSize: 10 }}>🎯 {p.goalPrompt.slice(0, 12)}...</Tag>}
                                </Space>
                              </div>
                              <Button size="small" type="link" onClick={() => setProductWizardOpen(true)}>
                                管理
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>

                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#fffbe6', borderRadius: 6, fontSize: 11, color: '#666' }}>
                    💡 完整的 KB / FAQ / 文件管理请前往 <Button type="link" href="/knowledge" style={{ padding: 0, fontSize: 11 }}>知识库页面</Button>
                  </div>
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
        title={replaceTarget ? `切换 Bot（当前：@${replaceTarget.botUsername}）` : '添加 Bot Token'}
        open={registerVisible}
        onCancel={() => { setRegisterVisible(false); setReplaceTarget(null); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        {replaceTarget && (
          <Alert
            type="warning"
            showIcon
            message="切换 Bot 会删除旧记录并停止轮询，然后用新 Token 注册不同的 Bot。一个 Telegram Bot ID 只能对应一个 Token，所以这是切换到完全不同的 Bot。"
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
                {replaceTarget ? '切换并启动' : '注册并启动'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <CompanyInfoWizard
        open={companyWizardOpen}
        onClose={() => { setCompanyWizardOpen(false); void load(); }}
        tenantId={tenant?.id}
      />
      <ProductSetupWizard
        open={productWizardOpen}
        onClose={() => { setProductWizardOpen(false); void load(); }}
        tenantId={tenant?.id}
      />
    </div>
  );
}
