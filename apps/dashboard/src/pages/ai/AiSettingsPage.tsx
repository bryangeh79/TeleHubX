import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Divider, Form, Input,
  Modal, Popconfirm, Row, Select, Space, Switch, Table,
  Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, KeyOutlined,
  PlusOutlined, ReloadOutlined, SaveOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { aiApi, tenantsApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type ProviderId = 'openai' | 'deepseek' | 'gemini' | 'custom';

// ── helper ──────────────────────────────────────────────────────────────
function getCurrentUser(): { role?: string } {
  try {
    const raw = localStorage.getItem('telehubx:user');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ── 默认营销人设 ─────────────────────────────────────────────────────────
const DEFAULT_MARKETING_PROMPT = `你是一位专业的营销型 AI 助手，专门负责广告文案、客户沟通和销售转化。

你的目标：帮用户把产品表达得更清楚、更有吸引力、更容易让客户产生兴趣。文案必须适合 Telegram 发送 · 简短、自然、可信、有行动引导。

你擅长：广告文案 / 产品介绍 / 功能卖点 / Telegram 群组内容 / 销售话术优化 / 客户疑问回复 / 多个广告变体生成。

风格：专业、自然、简洁、有说服力 · 不夸张、不虚假、不像机器人。

每次生成优先考虑：客户为什么需要这个产品？能帮客户省什么？下一步应该做什么？

结果尽量加入行动引导，例如：
- 想了解更多，可以 Telegram 联系我们。
- 需要 demo，可以联系我安排。
- 想看系统效果，可以预约演示。

⚠️ 最重要规则 · 联系方式必须原样保留：
当你优化 / 改写 / 扩写 / 缩短 / 翻译 / 生成变体时，如果原文包含任何联系信息，必须 100% 完整保留 · 不删除 · 不改错 · 不替换。`;

// ── 租户智能回复配置 Modal ────────────────────────────────────────────────
function TenantAiModal({
  open, tenantId, onSave, onClose,
}: {
  open: boolean;
  tenantId: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tenantId) return;
    tenantsApi.getSettings(tenantId).then(r => {
      const s = r.data;
      setCurrentProvider(s.tenantAiProvider ?? null);
      form.setFieldsValue({
        tenantAiProvider: s.tenantAiProvider ?? 'openai',
        tenantAiModel: s.tenantAiModel ?? '',
        tenantAiBaseUrl: s.tenantAiBaseUrl ?? '',
        tenantAiApiKey: '',
      });
    }).catch(() => {});
  }, [open, tenantId, form]);

  const handleSave = async () => {
    if (!tenantId) { antdMessage.error('租户 ID 未加载，请刷新页面'); return; }
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = {
        tenantAiProvider: values.tenantAiProvider,
        tenantAiModel: values.tenantAiModel || null,
        tenantAiBaseUrl: values.tenantAiBaseUrl || null,
      };
      if (values.tenantAiApiKey?.trim()) {
        payload.tenantAiApiKey = values.tenantAiApiKey.trim();
      }
      await tenantsApi.updateSettings(tenantId, payload);
      antdMessage.success('智能回复 AI 配置已保存');
      onSave();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await tenantsApi.updateSettings(tenantId, {
        tenantAiProvider: null,
        tenantAiApiKey: '',
        tenantAiModel: null,
        tenantAiBaseUrl: null,
      });
      antdMessage.success('已清空，将回落到平台兜底');
      onSave();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '清空失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<Space><KeyOutlined />智能回复 AI 配置</Space>}
      onCancel={onClose}
      width={560}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          {currentProvider && (
            <Popconfirm
              title="清空后将回落到平台兜底 Key，确认？"
              onConfirm={handleClear}
              okText="确认清空" cancelText="取消" okButtonProps={{ danger: true }}
            >
              <Button danger loading={saving}>清空配置</Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>保存</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="此 API Key 用于客户与机器人聊天的 AI 回复，Token 费用由你自己承担。留空则回落到平台兜底 Key。"
      />
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="tenantAiProvider" label="AI 提供商" rules={[{ required: true }]}>
              <Select options={[
                { value: 'openai',   label: 'OpenAI' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'gemini',   label: 'Google Gemini' },
                { value: 'custom',   label: '自定义 (OpenAI 兼容)' },
              ]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="tenantAiModel" label="模型 (可选)">
              <Input placeholder="gpt-4o-mini / deepseek-chat" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="tenantAiApiKey" label="API Key"
          extra={currentProvider ? '留空则保留现有 Key（不会显示明文）' : '首次配置请填写'}>
          <Input.Password
            placeholder={currentProvider ? '••••••••（保留现有）' : 'sk-...'}
            autoComplete="off"
          />
        </Form.Item>
        <Form.Item name="tenantAiBaseUrl" label="Base URL（自定义时填）">
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ── 平台 Provider 新增/编辑 Modal（Admin Only）────────────────────────────
function PlatformProviderModal({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!open) { form.resetFields(); setTestResult(null); }
  }, [open, form]);

  const handleTest = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setTesting(true);
    setTestResult(null);
    try {
      await aiApi.reply({
        chatId: `_platform_test_${Date.now()}`,
        userMessage: '测试连接',
        provider: values.provider === 'custom' ? 'openai' : values.provider,
        model: values.model || undefined,
      });
      setTestResult({ ok: true, msg: '连接成功 ✓' });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err?.response?.data?.message ?? '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新增 AI Provider"
      onCancel={onClose}
      width={540}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose}>取消</Button>
          <Button loading={testing} onClick={handleTest}>测试连接</Button>
          <Button type="primary" onClick={() => { antdMessage.info('平台 Provider 通过 .env 配置，重启后生效'); onSuccess(); }}>
            确认
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="平台 Provider 的 API Key 在服务器 .env 文件中配置，修改后需重启服务生效。此处仅用于查看和测试。"
      />
      <Form form={form} layout="vertical">
        <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
          <Select options={[
            { value: 'openai',   label: 'OpenAI' },
            { value: 'deepseek', label: 'DeepSeek' },
            { value: 'gemini',   label: 'Google Gemini' },
          ]} />
        </Form.Item>
        <Form.Item name="model" label="模型 (可选)">
          <Input placeholder="使用 .env AI_MODEL 默认值" />
        </Form.Item>
      </Form>
      {testResult && (
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          message={testResult.msg}
          style={{ marginTop: 12 }}
        />
      )}
    </Modal>
  );
}

// ── AI 营销人设 Modal ─────────────────────────────────────────────────────
function MarketingPromptModal({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(DEFAULT_MARKETING_PROMPT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 从 localStorage 读取保存的人设（本地持久化）
    const saved = localStorage.getItem('telehubx:marketingPrompt');
    setPrompt(saved ?? DEFAULT_MARKETING_PROMPT);
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem('telehubx:marketingPrompt', prompt);
      await new Promise(r => setTimeout(r, 300)); // simulate save
      antdMessage.success('AI 营销人设已保存');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#52c41a' }} />
          AI 营销人设
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            · 广告 / 开场白 AI 生成变体时注入 system prompt
          </Text>
        </Space>
      }
      onCancel={onClose}
      width={680}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={() => setPrompt(DEFAULT_MARKETING_PROMPT)}>恢复默认</Button>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>保存</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="在这里定义 AI 生成广告 / 开场白变体时的角色、风格、规则。修改立即生效，下次生成变体就用新人设。"
      />
      <TextArea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={14}
        maxLength={8000}
        showCount
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    </Modal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function AiSettingsPage() {
  const user = getCurrentUser();
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tenantAi, setTenantAi] = useState<any>(null);
  const [tenantId, setTenantId] = useState<string>('');

  // Modals
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [platformModalOpen, setPlatformModalOpen] = useState(false);
  const [marketingModalOpen, setMarketingModalOpen] = useState(false);

  // AI master toggle (local)
  const [aiEnabled, setAiEnabled] = useState(() => {
    return localStorage.getItem('telehubx:aiEnabled') !== 'false';
  });

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      // 先拿真实 tenant UUID，再并行加载 AI info + settings
      const defaultTenant = await tenantsApi.getDefault();
      const realTenantId: string = defaultTenant.data?.id ?? '';
      if (realTenantId) setTenantId(realTenantId);

      const [infoRes, settingsRes] = await Promise.all([
        aiApi.info(),
        realTenantId
          ? tenantsApi.getSettings(realTenantId).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);
      setInfo(infoRes.data ?? null);
      setTenantAi(settingsRes.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadInfo(); }, [loadInfo]);

  const toggleAi = (v: boolean) => {
    setAiEnabled(v);
    localStorage.setItem('telehubx:aiEnabled', String(v));
    antdMessage.success(v ? 'AI 文本改写已开启' : 'AI 文本改写已关闭');
  };

  const PROVIDER_LABELS: Record<string, string> = {
    openai: 'OpenAI', deepseek: 'DeepSeek', gemini: 'Google Gemini',
  };
  const PROVIDER_COLORS: Record<string, string> = {
    openai: 'blue', deepseek: 'purple', gemini: 'orange',
  };

  const platformColumns = [
    {
      title: '类型',
      dataIndex: 'id',
      width: 100,
      render: (id: string) => (
        <Tag color={PROVIDER_COLORS[id] ?? 'default'}>{PROVIDER_LABELS[id] ?? id}</Tag>
      ),
    },
    {
      title: '名称',
      dataIndex: 'label',
      render: (label: string, row: any) => (
        <Space>
          <Text>{label} · {row.defaultModel}</Text>
          {row.id === info?.defaultProvider && (
            <Tag color="blue" style={{ fontSize: 10 }}>默认</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '模型',
      dataIndex: 'defaultModel',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'API Key',
      dataIndex: 'keyEnv',
      render: (env: string) => (
        <Text code style={{ fontSize: 11 }}>{env}</Text>
      ),
    },
    {
      title: '最近测试',
      dataIndex: 'configured',
      width: 100,
      render: (configured: boolean) => configured
        ? <Tag color="success" icon={<CheckCircleOutlined />}>✓ OK</Tag>
        : <Tag color="error" icon={<CloseCircleOutlined />}>未配置</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'configured',
      width: 80,
      render: (v: boolean) => (
        <Switch
          size="small"
          checked={v}
          disabled
          style={{ background: v ? '#52c41a' : undefined }}
        />
      ),
    },
    ...(isSuperAdmin ? [{
      title: '操作',
      width: 80,
      render: (_: any, row: any) => (
        <Button size="small" onClick={() => setPlatformModalOpen(true)}>测试</Button>
      ),
    }] : []),
  ];

  const marketingPromptSaved = !!localStorage.getItem('telehubx:marketingPrompt');

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>AI 配置</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            配置 DeepSeek / Gemini / OpenAI / Claude 的 API Key
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadInfo()} loading={loading}>刷新</Button>
      </div>

      {/* 总开关 */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Space>
              <Text strong style={{ fontSize: 15 }}>AI 文本改写 · 总开关</Text>
              <Tooltip title="开启后系统会用 AI 为聊天 / 广告文案自动生成多样化变体，降低封号风险">
                <Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>ⓘ 关于 API Key</Text>
              </Tooltip>
            </Space>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {aiEnabled
                  ? '已开启 · 系统会用 AI 为聊天 / 广告文案自动生成多样化变体 · 降低封号风险'
                  : '已关闭 · AI 改写功能停用'}
              </Text>
            </div>
          </div>
          <Switch
            checked={aiEnabled}
            onChange={toggleAi}
            style={{ background: aiEnabled ? '#52c41a' : undefined }}
          />
        </div>
      </Card>

      {/* 平台 AI Providers — Admin Only */}
      {isSuperAdmin && (
        <Card
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <KeyOutlined />
              <span>平台 AI Providers ({info?.providers?.filter((p: any) => p.configured).length ?? 0})</span>
            </Space>
          }
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} size="small" onClick={() => void loadInfo()} loading={loading}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} size="small" onClick={() => setPlatformModalOpen(true)}>
                新增
              </Button>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="平台兜底 Key — 广告变体生成 / 开场白评分 / FAQ 生成等内部任务使用，费用由平台承担。通过服务器 .env 文件配置。"
          />
          <Table
            dataSource={info?.providers ?? []}
            columns={platformColumns}
            rowKey="id"
            size="small"
            pagination={false}
            loading={loading}
          />
        </Card>
      )}

      {/* 智能回复 AI Key — 所有租户可配置 */}
      <Card
        style={{ marginBottom: 16 }}
        title={<Space><KeyOutlined />智能回复 AI Key</Space>}
        extra={
          <Button type="primary" onClick={() => setTenantModalOpen(true)}>
            {tenantAi?.tenantAiProvider ? '修改配置' : '立即配置'}
          </Button>
        }
      >
        <Row gutter={24} align="middle">
          <Col flex="auto">
            <Text type="secondary" style={{ fontSize: 13 }}>
              用于客户与机器人聊天时的 AI 智能回复，Token 费用由你自己承担。
            </Text>
            <div style={{ marginTop: 8 }}>
              {tenantAi?.tenantAiProvider ? (
                <Space>
                  <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
                  <Tag color={PROVIDER_COLORS[tenantAi.tenantAiProvider] ?? 'default'}>
                    {PROVIDER_LABELS[tenantAi.tenantAiProvider] ?? tenantAi.tenantAiProvider}
                  </Tag>
                  {tenantAi.tenantAiModel && <Tag>{tenantAi.tenantAiModel}</Tag>}
                </Space>
              ) : (
                <Tag color="warning" icon={<CloseCircleOutlined />}>未配置 · 回落到平台兜底 Key</Tag>
              )}
            </div>
          </Col>
        </Row>
      </Card>

      {/* AI 营销人设 */}
      <Card
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#52c41a' }} />
            <span>AI 营销人设</span>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              · 广告 / 开场白 AI 生成变体时注入 system prompt
            </Text>
          </Space>
        }
        extra={
          <Space>
            <Button onClick={() => setMarketingModalOpen(true)}>
              {marketingPromptSaved ? '查看 / 编辑' : '设置'}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => setMarketingModalOpen(true)}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="在这里定义 AI 生成广告 / 开场白变体时的角色、风格、规则。修改立即生效，下次生成变体就用新人设。"
          style={{ marginBottom: 12 }}
        />
        <div
          style={{
            background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6,
            padding: '10px 12px', maxHeight: 120, overflow: 'hidden', cursor: 'pointer',
            position: 'relative',
          }}
          onClick={() => setMarketingModalOpen(true)}
        >
          <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#555' }}>
            {(localStorage.getItem('telehubx:marketingPrompt') ?? DEFAULT_MARKETING_PROMPT).slice(0, 300)}…
          </Text>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 40, background: 'linear-gradient(transparent, #fafafa)',
          }} />
        </div>
      </Card>

      {/* Modals */}
      <TenantAiModal
        open={tenantModalOpen}
        tenantId={tenantId}
        onSave={() => { setTenantModalOpen(false); void loadInfo(); }}
        onClose={() => setTenantModalOpen(false)}
      />
      <PlatformProviderModal
        open={platformModalOpen}
        onClose={() => setPlatformModalOpen(false)}
        onSuccess={() => { setPlatformModalOpen(false); void loadInfo(); }}
      />
      <MarketingPromptModal
        open={marketingModalOpen}
        onClose={() => setMarketingModalOpen(false)}
      />
    </div>
  );
}
