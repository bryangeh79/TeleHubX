import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
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
  BookOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MessageOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SafetyOutlined,
  SendOutlined,
  StopOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import CompanyInfoWizard from '../ai/CompanyInfoWizard';
import ProductSetupWizard from '../ai/ProductSetupWizard';
import GeneralFaqDrawer from './GeneralFaqDrawer';
import HumanAgentsCard from './HumanAgentsCard';
import { aiApi, knowledgeApi, tenantsApi } from '../../services/api';
import { useT } from '../../i18n';

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

/** Round-7: 改函数返回, 接 useT() 实现 4 语 mode card */
function buildModeCards(t: (k: string) => string): Array<{
  key: ReplyMode;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}> {
  return [
    {
      key: 'off',
      icon: <StopOutlined style={{ fontSize: 28 }} />,
      title: t('cs.replyMode.off'),
      desc: t('cs.replyMode.off.desc'),
    },
    {
      key: 'faq',
      icon: <QuestionCircleOutlined style={{ fontSize: 28 }} />,
      title: t('cs.replyMode.faq'),
      desc: t('cs.replyMode.faq.desc'),
    },
    {
      key: 'smart',
      icon: <RobotOutlined style={{ fontSize: 28 }} />,
      title: t('cs.replyMode.smart'),
      desc: t('cs.replyMode.smart.desc'),
      badge: t('cs.replyMode.recommended'),
    },
  ];
}

// ── 高级设置 Tab 组件 ─────────────────────────────────────────────────
function AdvancedSettingsTab({
  settings, tenantId, onSaved,
}: {
  settings: TenantSettings | null;
  tenantId?: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [dailyLimit, setDailyLimit] = useState<number>(50);
  const [quietEnabled, setQuietEnabled] = useState<boolean>(false);
  const [quietStart, setQuietStart] = useState<string>('22:00');
  const [quietEnd, setQuietEnd] = useState<string>('08:00');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDailyLimit(settings.dailyReplyLimit ?? 50);
    setQuietEnabled(settings.quietHoursEnabled ?? false);
    setQuietStart(settings.quietHoursStart ?? '22:00');
    setQuietEnd(settings.quietHoursEnd ?? '08:00');
  }, [settings]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await tenantsApi.updateSettings(tenantId, {
        dailyReplyLimit: dailyLimit,
        quietHoursEnabled: quietEnabled,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
      });
      antdMessage.success(t('cs.adv.saved'));
      onSaved();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const TIME_OPTIONS: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '30']) {
      TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`);
    }
  }

  return (
    <div style={{ padding: '16px 0', maxWidth: 720 }}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t('cs.adv.saveTakesEffect')} />

      {/* 每日回复上限 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={12} align="middle">
          <Col flex="200px">
            <Text strong>{t('page.cs.dailyLimit')}</Text>
          </Col>
          <Col flex="auto">
            <InputNumber
              value={dailyLimit}
              onChange={(v) => setDailyLimit(Number(v) || 50)}
              min={1}
              max={500}
              addonAfter={t('cs.adv.dailyLimitUnit')}
              style={{ width: 160 }}
            />
          </Col>
        </Row>
      </Card>

      {/* 静默时段 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={12} align="middle" style={{ marginBottom: quietEnabled ? 12 : 0 }}>
          <Col flex="200px">
            <Text strong>{t('page.cs.quietHours')}</Text>
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              {t('cs.adv.quietDesc')}
            </div>
          </Col>
          <Col flex="auto">
            <Switch checked={quietEnabled} onChange={setQuietEnabled} />
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {quietEnabled ? t('cs.adv.quietOn') : t('cs.adv.quietOff')}
            </Text>
          </Col>
        </Row>
        {quietEnabled && (
          <Row gutter={12} align="middle">
            <Col flex="200px"></Col>
            <Col flex="auto">
              <Space>
                <Select value={quietStart} onChange={setQuietStart} size="small" style={{ width: 100 }}
                  options={TIME_OPTIONS.map(opt => ({ value: opt, label: opt }))} />
                <Text type="secondary">{t('cs.adv.quietTo')}</Text>
                <Select value={quietEnd} onChange={setQuietEnd} size="small" style={{ width: 100 }}
                  options={TIME_OPTIONS.map(opt => ({ value: opt, label: opt }))} />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('cs.adv.quietHint')}
                </Text>
              </Space>
            </Col>
          </Row>
        )}
      </Card>

      {/* 频率限制 - 暂时只展示，未来可扩展 */}
      <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
        <Row gutter={12} align="middle">
          <Col flex="200px">
            <Text strong>{t('cs.adv.replyInterval')}</Text>
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              {t('cs.adv.replyIntervalDesc')}
            </div>
          </Col>
          <Col flex="auto">
            <Tag color="default">{t('cs.adv.replyIntervalDefault')}</Tag>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              {t('cs.adv.replyIntervalAdminHint')}
            </Text>
          </Col>
        </Row>
      </Card>

      <div style={{ marginTop: 20, textAlign: 'right' }}>
        <Button type="primary" icon={<CheckCircleFilled />}
          onClick={handleSave} loading={saving} disabled={!tenantId}>
          {t('cs.adv.saveBtn')}
        </Button>
      </div>
    </div>
  );
}

// ── 客户消息处理流程图 ────────────────────────────────────────────────
// 视觉化展示 6 步消息流，FAQ 命中分支用绿/红 label 标注
function MessageFlowDiagram() {
  const t = useT();
  const steps = [
    {
      icon: <UserOutlined style={{ fontSize: 22, color: '#1677ff' }} />,
      bg: '#e6f4ff',
      title: t('cs.flow.node.user'),
      subtitle: t('cs.flow.node.user.sub'),
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#fa8c16' }} />,
      bg: '#fff7e6',
      title: t('cs.flow.node.aggregate'),
      subtitle: t('cs.flow.node.aggregate.sub'),
    },
    {
      icon: <QuestionCircleOutlined style={{ fontSize: 22, color: '#722ed1' }} />,
      bg: '#f9f0ff',
      title: t('cs.flow.node.faq'),
      subtitle: t('cs.flow.node.faq.sub'),
      isBranch: true,
    },
    {
      icon: <BookOutlined style={{ fontSize: 22, color: '#13c2c2' }} />,
      bg: '#e6fffb',
      title: t('cs.flow.node.ai'),
      subtitle: t('cs.flow.node.ai.sub'),
    },
    {
      icon: <SafetyOutlined style={{ fontSize: 22, color: '#fa8c16' }} />,
      bg: '#fff7e6',
      title: t('cs.flow.node.guardrail'),
      subtitle: t('cs.flow.node.guardrail.sub'),
    },
    {
      icon: <SendOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      bg: '#f6ffed',
      title: t('cs.flow.node.send'),
      subtitle: t('cs.flow.node.send.sub'),
    },
  ];

  return (
    <div style={{
      background: '#fafafa',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      padding: '24px 16px 16px',
      marginTop: 12,
      position: 'relative',
      overflowX: 'auto',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 4,
        minWidth: 880,
        position: 'relative',
      }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: '1 1 auto' }}>
            {/* 节点卡片 */}
            <div style={{
              background: 'white',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              padding: '12px 10px',
              textAlign: 'center',
              minWidth: 110,
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: s.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 8px',
              }}>
                {s.icon}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{s.title}</div>
              <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{s.subtitle}</div>
            </div>

            {/* 箭头 + 命中/未命中 label */}
            {i < steps.length - 1 && (
              <div style={{
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                margin: '0 4px',
                minWidth: 60,
              }}>
                {s.isBranch && (
                  <span style={{
                    fontSize: 11, color: '#52c41a', fontWeight: 600,
                    marginBottom: 2,
                  }}>
                    {t('cs.flow.hit')}
                  </span>
                )}
                <span style={{
                  color: '#bfbfbf',
                  fontSize: 18,
                  letterSpacing: -2,
                  userSelect: 'none',
                }}>
                  ─ ─ ▶
                </span>
                {s.isBranch && (
                  <span style={{
                    fontSize: 11, color: '#cf1322', fontWeight: 600,
                    marginTop: 2,
                  }}>
                    {t('cs.flow.miss')}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 命中分支说明 — 在底部画一行小注释，避免实际 SVG 折线复杂度 */}
      <div style={{
        marginTop: 14,
        padding: '8px 12px',
        background: '#fff',
        border: '1px dashed #d9d9d9',
        borderRadius: 6,
        fontSize: 12,
        color: '#595959',
      }}>
        <Space size={16} wrap>
          <span><Tag color="success" style={{ fontSize: 11, marginRight: 4 }}>{t('cs.flow.hitTag')}</Tag>{t('cs.flow.hitDesc')}</span>
          <span><Tag color="error" style={{ fontSize: 11, marginRight: 4 }}>{t('cs.flow.missTag')}</Tag>{t('cs.flow.missDesc')}</span>
        </Space>
      </div>
    </div>
  );
}

export default function CsPage() {
  const t = useT();
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
  const [generalFaqOpen, setGeneralFaqOpen] = useState(false);
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
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
          antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
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
      ? <Badge status="processing" text={t('cs.bot.polling')} />
      : <Badge status="default" text={t('cs.bot.stopped')} />
    : <Badge status="error" text={t('cs.bot.notSet')} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <CustomerServiceOutlined style={{ marginRight: 8 }} />
            {t('page.cs.title')}
          </Title>
        </div>
        <Space size={8}>
          <Button
            size="large"
            icon={<BankOutlined />}
            onClick={() => setCompanyWizardOpen(true)}
            style={{ fontWeight: 500 }}
          >
            {t('cs.companyInfo.title')}
          </Button>
          <Button
            size="large"
            icon={<QuestionCircleOutlined />}
            onClick={() => setGeneralFaqOpen(true)}
            style={{ fontWeight: 500 }}
          >
            {t('drawer.generalFaq')}
          </Button>
          <Button
            size="large"
            type="primary"
            icon={<AppstoreOutlined />}
            onClick={() => setProductWizardOpen(true)}
            style={{ fontWeight: 500 }}
          >
            {t('cs.product.title')}
          </Button>
          {botStatusBadge}
        </Space>
      </div>

      {/* Bot 配置 */}
      <Card
        title={<Space><ApiOutlined />{t('cs.bot.section')}</Space>}
        style={{ marginBottom: 16 }}
        extra={
          !activeBot && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterVisible(true)}>
              {t('cs.bot.addToken')}
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
                    ? <Tag color="green" icon={<PlayCircleOutlined />}>{t('cs.bot.polling')}</Tag>
                    : <Tag color="default" icon={<PauseCircleOutlined />}>{t('cs.bot.stopped')}</Tag>}
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('cs.bot.recordId')}: <Text code copyable={{ text: activeBot.id }} style={{ fontSize: 11 }}>{activeBot.id.slice(0, 8)}…</Text>
                  {' · '}{t('cs.bot.received', { count: activeBot.pollingOffset })}
                  {activeBot.lastPollAt && (
                    <> · {t('cs.bot.lastActivity')}: {new Date(activeBot.lastPollAt).toLocaleTimeString()}</>
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
                  {activeBot.isActive ? t('cs.bot.stopPolling') : t('cs.bot.startPolling')}
                </Button>
                <Tooltip title="检查 webhook 是否被其他系统占用，并可一键清除">
                  <Button icon={<WarningOutlined />} onClick={() => handleDiagnose(activeBot)}>
                    {t('cs.bot.diagnose')}
                  </Button>
                </Tooltip>
                <Tooltip title="切换到不同的 Bot（删除当前记录，注册新 Bot 的 Token）">
                  <Button icon={<SwapOutlined />} onClick={() => openReplace(activeBot)}>
                    {t('cs.bot.switch')}
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
              {t('cs.bot.empty')}
            </Paragraph>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterVisible(true)}>
              {t('cs.bot.addToken')}
            </Button>
          </div>
        )}
      </Card>

      {/* 自动回复模式 */}
      <Card title={t('page.cs.faqMode')} style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={12}>
          {buildModeCards(t).map((m) => {
            const active = m.key === currentMode;
            const aiBlocked = m.key === 'smart' && !aiConfigured;
            return (
              <Col span={8} key={m.key} style={{ display: 'flex' }}>
                <Card
                  hoverable={!savingMode}
                  onClick={() => handleModeChange(m.key)}
                  style={{
                    width: '100%',
                    cursor: savingMode ? 'wait' : 'pointer',
                    border: active ? '2px solid #1677ff' : '1px solid #f0f0f0',
                    background: active ? '#f0f7ff' : '#fafafa',
                    borderRadius: 8,
                    opacity: aiBlocked && !active ? 0.7 : 1,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                  styles={{
                    body: {
                      padding: '24px 16px',
                      minHeight: 180,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      textAlign: 'center',
                      width: '100%',
                    },
                  }}
                >
                  {active && (
                    <CheckCircleFilled
                      style={{ position: 'absolute', top: 8, right: 8, color: '#1677ff', fontSize: 16 }}
                    />
                  )}
                  <div style={{ color: active ? '#1677ff' : '#999', marginBottom: 8, fontSize: 28, lineHeight: 1 }}>
                    {m.icon}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ color: active ? '#1677ff' : undefined, fontSize: 14 }}>{m.title}</Text>
                    {m.badge && <Tag color="blue" style={{ marginLeft: 6, fontSize: 11 }}>{m.badge}</Tag>}
                  </div>
                  <Paragraph type="secondary" style={{ fontSize: 12, margin: 0, flex: 1, lineHeight: 1.6 }}>
                    {m.desc}
                  </Paragraph>
                  <div style={{ marginTop: 12 }}>
                    {m.key === 'faq' && (
                      <Tag color="green" style={{ fontSize: 11 }}>{t('cs.tag.noAiKey')}</Tag>
                    )}
                    {m.key === 'smart' && (
                      <Tag color={aiConfigured ? 'blue' : 'orange'} style={{ fontSize: 11 }}>
                        {aiConfigured ? t('cs.tag.hasAiKey') : t('cs.tag.needAiKey')}
                      </Tag>
                    )}
                  </div>
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
            message={t('cs.alert.noAiKey.title')}
            description={t('cs.alert.noAiKey.desc')}
            action={<Button size="small" type="link" href="/ai">{t('cs.alert.noAiKey.action')}</Button>}
          />
        )}
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message={t('cs.alert.modeImmediate')}
        />
      </Card>

      {/* 概览 + 知识库 + 高级设置 */}
      <Card>
        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: t('cs.tab.overview'),
              children: (
                <div>
                  <Row gutter={16} style={{ marginBottom: 24 }}>
                    <Col span={6}>
                      <Statistic title={t('cs.stat.kb')} value={kbCount} suffix={t('cs.stat.kbUnit')} />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('cs.stat.currentMode')}
                        value={currentMode === 'smart' ? t('cs.stat.modeSmart') : currentMode === 'faq' ? t('cs.stat.modeFaq') : t('cs.stat.modeOff')}
                        valueStyle={{
                          color: currentMode === 'smart' ? '#1677ff' : currentMode === 'faq' ? '#52c41a' : '#999',
                          fontSize: 18,
                        }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic title={t('cs.stat.dailyLimit')} value={settings?.dailyReplyLimit ?? 50} suffix={t('cs.stat.dailyLimitUnit')} />
                    </Col>
                    <Col span={6}>
                      <Statistic title={t('cs.stat.handoffTriggers')} value="13+" />
                    </Col>
                  </Row>

                  <div style={{ marginTop: 16 }}>
                    <Text strong style={{ fontSize: 14 }}>{t('cs.flow.title')}</Text>
                  </div>
                  <MessageFlowDiagram />
                  <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                    {t('cs.flow.handoffNote')}
                  </Paragraph>
                </div>
              ),
            },
            {
              key: 'knowledge',
              label: <span>{t('cs.tab.knowledge')} <Tag color="blue" style={{ marginLeft: 4 }}>{(companyKb ? 1 : 0) + productKbs.length}</Tag></span>,
              children: (
                <div style={{ padding: '12px 0' }}>
                  {/* ── 公司资料 ── WAhubX 风格大卡片 */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Space>
                        <BankOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                        <Text strong style={{ fontSize: 14 }}>{t('cs.kb.company')}</Text>
                        {companyKb && <Tag color="success" style={{ fontSize: 11 }}>{t('cs.kb.configured')}</Tag>}
                      </Space>
                      <Button size="small" icon={companyKb ? <EditOutlined /> : <PlusOutlined />}
                        type={companyKb ? 'default' : 'primary'}
                        onClick={() => setCompanyWizardOpen(true)}>
                        {companyKb ? t('cs.kb.edit') : t('cs.kb.setup')}
                      </Button>
                    </div>

                    {companyKb ? (() => {
                      let info: any = {};
                      try { info = JSON.parse(companyKb.description ?? '{}'); } catch {}
                      const companyName = info.companyName
                        || (companyKb.name && !companyKb.name.startsWith('undefined')
                          ? companyKb.name.replace(' - 公司资料', '')
                          : '')
                        || t('cs.kb.unnamedCompany');
                      const contactCount = (info.contacts ?? []).filter((c: any) => c.value).length;
                      return (
                        <Card hoverable style={{ borderColor: '#bae0ff' }}
                          styles={{ body: { padding: '14px 18px' } }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                            <div style={{
                              width: 44, height: 44, borderRadius: 8, background: '#e6f4ff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <BankOutlined style={{ fontSize: 22, color: '#1677ff' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div>
                                <Text strong style={{ fontSize: 15 }}>{companyName}</Text>
                                {info.industry && <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>· {info.industry}</Text>}
                              </div>
                              <Paragraph style={{ fontSize: 12, color: '#666', margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}
                                ellipsis={{ rows: 2, expandable: true, symbol: t('cs.kb.expand') }}>
                                {companyKb.goalPrompt || info.about || '—'}
                              </Paragraph>
                              <Space size={4} wrap>
                                {contactCount > 0 && <Tag color="green" style={{ fontSize: 10 }}>{t('cs.kb.contactCount', { count: contactCount })}</Tag>}
                                {info.email && <Tag color="cyan" style={{ fontSize: 10 }}>📧 {info.email}</Tag>}
                                {info.website && <Tag color="purple" style={{ fontSize: 10 }}>🌐 {t('cs.kb.website')}</Tag>}
                                {info.hoursFrom && <Tag style={{ fontSize: 10 }}>⏰ {info.hoursFrom}-{info.hoursTo} {info.timeFrom}-{info.timeTo}</Tag>}
                              </Space>
                            </div>
                          </div>
                        </Card>
                      );
                    })() : (
                      <Card style={{ background: '#fafafa', borderStyle: 'dashed' }}
                        styles={{ body: { padding: '20px 16px', textAlign: 'center' } }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('cs.kb.companyEmpty')}
                        </Text>
                      </Card>
                    )}
                  </div>

                  <Divider style={{ margin: '8px 0 16px' }} />

                  {/* ── 产品资料 ── WAhubX 风格列表 */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Space>
                        <AppstoreOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                        <Text strong style={{ fontSize: 14 }}>{t('cs.kb.product')}</Text>
                        {productKbs.length > 0 && <Tag color="success" style={{ fontSize: 11 }}>{t('cs.kb.productCount', { count: productKbs.length })}</Tag>}
                      </Space>
                      <Button size="small" type="primary" icon={<PlusOutlined />}
                        onClick={() => setProductWizardOpen(true)}>
                        {t('cs.kb.manageProduct')}
                      </Button>
                    </div>

                    {productKbs.length === 0 ? (
                      <Card style={{ background: '#fafafa', borderStyle: 'dashed' }}
                        styles={{ body: { padding: '20px 16px', textAlign: 'center' } }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('cs.kb.productEmpty')}
                        </Text>
                      </Card>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {productKbs.map((p: any) => {
                          let info: any = {};
                          try { info = JSON.parse(p.description ?? '{}'); } catch {}
                          const faqCount = productFaqCounts[p.id];
                          const productName = info.productName ?? p.name.replace(' - 产品资料', '');
                          const goalShort = p.goalPrompt
                            ? (p.goalPrompt.length > 24 ? p.goalPrompt.slice(0, 24) + '...' : p.goalPrompt)
                            : null;
                          return (
                            <Card key={p.id} hoverable
                              styles={{ body: { padding: '12px 16px' } }}
                              style={{ cursor: 'pointer' }}
                              onClick={() => setProductWizardOpen(true)}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    width: 40, height: 40, borderRadius: 6, background: '#f6ffed',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                  }}>
                                    <FileTextOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: '#222' }}>
                                      {productName}
                                      {info.price && (
                                        <Tag color="orange" style={{ marginLeft: 8, fontSize: 10 }}>{info.price}</Tag>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                                      {faqCount === undefined ? t('cs.kb.docCountLoading') : t('cs.kb.docCount', { faqCount })}
                                      {goalShort && <span style={{ marginLeft: 10 }}>· 🎯 {goalShort}</span>}
                                    </div>
                                  </div>
                                </div>
                                <Dropdown
                                  trigger={['click']}
                                  menu={{
                                    items: [
                                      { key: 'edit', icon: <EditOutlined />, label: '编辑',
                                        onClick: ({ domEvent }) => { domEvent.stopPropagation(); setProductWizardOpen(true); } },
                                      { key: 'backfill-variants', icon: <ThunderboltOutlined />, label: 'AI 补语义变体（升级匹配率）',
                                        onClick: async ({ domEvent }) => {
                                          domEvent.stopPropagation();
                                          Modal.confirm({
                                            title: `为「${productName}」FAQ 补语义变体？`,
                                            content: '将调 AI 为每条还没变体的 FAQ 生成 4 个同义问法（var: tag），让客户用各种说法都能命中。已有变体的 FAQ 默认跳过。',
                                            okText: '开始',
                                            cancelText: '取消',
                                            onOk: async () => {
                                              try {
                                                const res = await knowledgeApi.backfillVariants(p.id, false);
                                                antdMessage.success(`已升级 ${res.data.updated} 条 FAQ（跳过 ${res.data.skipped}）`);
                                                void load();
                                              } catch (err: any) {
                                                antdMessage.error(err?.response?.data?.message ?? '生成失败');
                                              }
                                            },
                                          });
                                        } },
                                      { type: 'divider' as const },
                                      { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true,
                                        onClick: async ({ domEvent }) => {
                                          domEvent.stopPropagation();
                                          Modal.confirm({
                                            title: `确认删除产品「${productName}」？`,
                                            content: '该产品的所有 FAQ 会一起删除，此操作无法撤销。',
                                            okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
                                            onOk: async () => {
                                              try {
                                                await knowledgeApi.deleteKb(p.id);
                                                antdMessage.success('产品已删除');
                                                void load();
                                              } catch { antdMessage.error(t('msg.deleteFailed')); }
                                            },
                                          });
                                        } },
                                    ],
                                  }}
                                >
                                  <Button type="text" icon={<MoreOutlined />}
                                    onClick={(e) => e.stopPropagation()} />
                                </Dropdown>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#fffbe6', borderRadius: 6, fontSize: 11, color: '#666' }}>
                    💡 {t('cs.kb.fullManageHint')} <Button type="link" href="/knowledge" style={{ padding: 0, fontSize: 11 }}>{t('cs.kb.knowledgePage')}</Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'advanced',
              label: t('cs.tab.advanced'),
              children: <AdvancedSettingsTab settings={settings} tenantId={tenant?.id} onSaved={() => void load()} />,
            },
            {
              key: 'human-agents',
              label: t('cs.tab.handoff'),
              children: <HumanAgentsCard tenantId={tenant?.id} />,
            },
          ]}
        />
      </Card>

      {/* 注册 / 更换 Bot Token Modal */}
      <Modal
        title={replaceTarget ? `${t('modal.bot.update')} (@${replaceTarget.botUsername})` : t('modal.bot.register')}
        open={registerVisible}
        onCancel={() => { setRegisterVisible(false); setReplaceTarget(null); form.resetFields(); }}
        footer={null}
        destroyOnClose
      >
        {replaceTarget && (
          <Alert
            type="warning"
            showIcon
            message={t('cs.bot.switchWarning')}
            style={{ marginBottom: 16 }}
          />
        )}
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          {t('cs.bot.tokenHelp')}
        </Paragraph>
        <Form form={form} layout="vertical" onFinish={handleRegister}>
          <Form.Item
            name="token"
            label={t('form.botToken')}
            rules={[
              { required: true, message: t('form.required') },
              { pattern: /^\d+:[A-Za-z0-9_-]{35,}$/, message: t('form.invalid') },
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
                {t('common.cancel')}
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {replaceTarget ? t('modal.bot.update') : t('modal.bot.register')}
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
      <GeneralFaqDrawer
        open={generalFaqOpen}
        onClose={() => { setGeneralFaqOpen(false); void load(); }}
        tenantId={tenant?.id}
      />
    </div>
  );
}
