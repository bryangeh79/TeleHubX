import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Input,
  Button,
  Typography,
  Space,
  Tag,
  Tooltip,
  Alert,
  Form,
  Select,
  message as antdMessage,
  Spin,
  Empty,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  KeyOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { aiApi, tenantsApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type ProviderId = 'openai' | 'deepseek' | 'gemini';

interface ProviderInfo {
  id: ProviderId;
  label: string;
  configured: boolean;
  keyEnv: string;
  defaultModel: string;
}

interface AiInfo {
  defaultProvider: ProviderId;
  providers: ProviderInfo[];
}

interface ReplyResult {
  reply: string;
  tokens: number;
  provider: ProviderId;
  model: string;
}

interface FaqResult {
  answer: string;
  tokens: number;
  provider: ProviderId;
  model: string;
}

type TenantAiProvider = 'openai' | 'deepseek' | 'gemini' | 'custom';

interface TenantAiSettings {
  tenantId: string;
  tenantAiProvider: TenantAiProvider | null;
  tenantAiModel: string | null;
  tenantAiBaseUrl: string | null;
}

export default function AiSettingsPage() {
  const [info, setInfo] = useState<AiInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Tenant-level AI config
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantAi, setTenantAi] = useState<TenantAiSettings | null>(null);
  const [tenantAiSaving, setTenantAiSaving] = useState(false);
  const [tenantForm] = Form.useForm<{
    tenantAiProvider: TenantAiProvider;
    tenantAiApiKey: string;
    tenantAiModel: string;
    tenantAiBaseUrl: string;
  }>();

  // Test playground
  const [testProvider, setTestProvider] = useState<ProviderId | undefined>();
  const [testModel, setTestModel] = useState('');
  const [chatId, setChatId] = useState('test-chat');
  const [userMessage, setUserMessage] = useState('Hello, how much does your service cost?');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [replyResult, setReplyResult] = useState<ReplyResult | null>(null);
  const [replyLoading, setReplyLoading] = useState(false);

  // FAQ playground
  const [faqQuestion, setFaqQuestion] = useState('What plans do you offer?');
  const [faqContext, setFaqContext] = useState('');
  const [faqResult, setFaqResult] = useState<FaqResult | null>(null);
  const [faqLoading, setFaqLoading] = useState(false);

  const loadTenant = useCallback(async () => {
    try {
      const tRes = await tenantsApi.getDefault();
      const t = tRes.data;
      setTenantId(t.id);
      const sRes = await tenantsApi.getSettings(t.id);
      const s: TenantAiSettings = sRes.data;
      setTenantAi(s);
      tenantForm.setFieldsValue({
        tenantAiProvider: s.tenantAiProvider ?? 'openai',
        tenantAiApiKey: '',
        tenantAiModel: s.tenantAiModel ?? '',
        tenantAiBaseUrl: s.tenantAiBaseUrl ?? '',
      });
    } catch (err: any) {
      // Tenant settings 加载失败不影响 platform 部分
      console.warn('Failed to load tenant AI settings', err);
    }
  }, [tenantForm]);

  const saveTenantAi = async (values: any) => {
    if (!tenantId) return;
    setTenantAiSaving(true);
    try {
      const payload: any = {
        tenantAiProvider: values.tenantAiProvider,
        tenantAiModel: values.tenantAiModel || null,
        tenantAiBaseUrl: values.tenantAiBaseUrl || null,
      };
      // 只在用户输入了新 key 时才发送
      if (values.tenantAiApiKey?.trim()) {
        payload.tenantAiApiKey = values.tenantAiApiKey.trim();
      }
      await tenantsApi.updateSettings(tenantId, payload);
      antdMessage.success('租户 AI 配置已保存');
      tenantForm.setFieldsValue({ tenantAiApiKey: '' });
      void loadTenant();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setTenantAiSaving(false);
    }
  };

  const clearTenantAi = async () => {
    if (!tenantId) return;
    setTenantAiSaving(true);
    try {
      await tenantsApi.updateSettings(tenantId, {
        tenantAiProvider: null,
        tenantAiApiKey: '',
        tenantAiModel: null,
        tenantAiBaseUrl: null,
      });
      antdMessage.success('已清空租户 AI 配置，将回落到平台兜底');
      void loadTenant();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '清空失败');
    } finally {
      setTenantAiSaving(false);
    }
  };

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aiApi.info();
      setInfo(res.data ?? null);
      // default the test provider to whatever the server says
      if (res.data?.defaultProvider) {
        setTestProvider(res.data.defaultProvider as ProviderId);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load AI info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
    void loadTenant();
  }, [loadInfo, loadTenant]);

  const handleTestReply = async () => {
    if (!userMessage.trim()) return;
    setReplyLoading(true);
    setReplyResult(null);
    try {
      const res = await aiApi.reply({
        chatId: chatId || 'test-chat',
        userMessage: userMessage.trim(),
        provider: testProvider,
        model: testModel || undefined,
        systemPrompt: systemPrompt || undefined,
      });
      setReplyResult(res.data);
      antdMessage.success(`Reply via ${res.data.provider} (${res.data.tokens} tokens)`);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Reply failed');
    } finally {
      setReplyLoading(false);
    }
  };

  const handleTestFaq = async () => {
    if (!faqQuestion.trim()) return;
    setFaqLoading(true);
    setFaqResult(null);
    try {
      const res = await aiApi.faq({
        question: faqQuestion.trim(),
        context: faqContext || undefined,
        provider: testProvider,
        model: testModel || undefined,
      });
      setFaqResult(res.data);
      antdMessage.success(`Answer via ${res.data.provider} (${res.data.tokens} tokens)`);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'FAQ failed');
    } finally {
      setFaqLoading(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await aiApi.clearConversation(chatId);
      antdMessage.success(`Cleared conversation history for "${chatId}"`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Clear failed');
    }
  };

  const configuredCount = info?.providers.filter(p => p.configured).length ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>AI 配置</Title>
        <Button icon={<ReloadOutlined />} onClick={() => void loadInfo()} loading={loading}>
          刷新
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="两层 AI Key：你的 Key（客服聊天用）vs 平台兜底（FAQ 生成等内部工具用）"
        description={
          <>
            <Text strong>① 你的 Key</Text>（下方表单）：用于客户与 Bot 聊天的 AI 兜底回复，token 由你自己付费。<br />
            <Text strong>② 平台兜底 Key</Text>（服务端 <Text code>.env</Text> 中的 <Text code>PLATFORM_*_API_KEY</Text>）：
            用于 FAQ 自动生成、文案优化、翻译等系统内部 AI 任务，由公司付费。
          </>
        }
      />

      {/* === Tenant AI Config (用户聊天用) === */}
      <Card
        title={<Space><KeyOutlined />你的 AI Key（用于客户聊天）</Space>}
        style={{ marginBottom: 16 }}
        extra={
          tenantAi?.tenantAiProvider ? (
            <Tag color="green" icon={<CheckCircleOutlined />}>已配置 · {tenantAi.tenantAiProvider}</Tag>
          ) : (
            <Tag color="orange" icon={<CloseCircleOutlined />}>未配置（将回落到平台兜底）</Tag>
          )
        }
      >
        <Form form={tenantForm} layout="vertical" onFinish={saveTenantAi}>
          <Space size={16} style={{ display: 'flex', flexWrap: 'wrap' }}>
            <Form.Item name="tenantAiProvider" label="Provider" style={{ minWidth: 180 }} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'openai',   label: 'OpenAI' },
                  { value: 'deepseek', label: 'DeepSeek' },
                  { value: 'gemini',   label: 'Google Gemini' },
                  { value: 'custom',   label: '自定义 (OpenAI 兼容)' },
                ]}
              />
            </Form.Item>
            <Form.Item name="tenantAiApiKey" label="API Key" style={{ flex: 1, minWidth: 280 }}
              extra={tenantAi?.tenantAiProvider ? '留空则保留现有 Key（不会显示）' : '首次配置请填写'}>
              <Input.Password placeholder={tenantAi?.tenantAiProvider ? '••••••••（保留现有）' : 'sk-...'} autoComplete="off" />
            </Form.Item>
            <Form.Item name="tenantAiModel" label="Model（可选）" style={{ minWidth: 200 }}>
              <Input placeholder="gpt-4o-mini / deepseek-chat" />
            </Form.Item>
            <Form.Item name="tenantAiBaseUrl" label="Base URL（自定义时填）" style={{ minWidth: 280 }}>
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
          </Space>
          <Space>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={tenantAiSaving}>保存</Button>
            {tenantAi?.tenantAiProvider && (
              <Button danger onClick={clearTenantAi} loading={tenantAiSaving}>清空（回落平台兜底）</Button>
            )}
          </Space>
        </Form>
      </Card>

      {loading && !info ? (
        <Spin />
      ) : !info ? (
        <Empty description="AI info unavailable" />
      ) : (
        <>
          <Card title={`平台兜底 Providers (${configuredCount}/${info.providers.length} configured)`} style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {info.providers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    border: `1px solid ${p.configured ? '#b7eb8f' : '#ffd591'}`,
                    borderRadius: 6,
                    background: p.configured ? '#f6ffed' : '#fff7e6',
                  }}
                >
                  <Space size={12}>
                    {p.configured ? (
                      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#fa8c16', fontSize: 18 }} />
                    )}
                    <div>
                      <Text strong>{p.label}</Text>
                      {p.id === info.defaultProvider && (
                        <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>DEFAULT</Tag>
                      )}
                      <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                        env: <Text code style={{ fontSize: 11 }}>{p.keyEnv}</Text> · default model:{' '}
                        <Text code style={{ fontSize: 11 }}>{p.defaultModel}</Text>
                      </div>
                    </div>
                  </Space>
                  <Tag color={p.configured ? 'success' : 'warning'}>
                    {p.configured ? 'configured' : 'not configured'}
                  </Tag>
                </div>
              ))}
            </Space>
          </Card>

          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                <span>Reply Playground</span>
                <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                  test live AI through /ai/reply
                </Text>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Form layout="vertical">
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item label="Provider override" style={{ flex: 1 }}>
                  <Select
                    value={testProvider}
                    onChange={(v) => setTestProvider(v)}
                    options={info.providers.map(p => ({
                      value: p.id,
                      label: `${p.label}${p.configured ? '' : ' (no key)'}`,
                      disabled: !p.configured,
                    }))}
                  />
                </Form.Item>
                <Form.Item label="Model override" style={{ flex: 1 }}>
                  <Input
                    value={testModel}
                    onChange={(e) => setTestModel(e.target.value)}
                    placeholder="leave empty for provider default"
                  />
                </Form.Item>
                <Form.Item label="Chat ID" style={{ width: 160 }}>
                  <Input value={chatId} onChange={(e) => setChatId(e.target.value)} />
                </Form.Item>
              </Space.Compact>

              <Form.Item label="System prompt (optional)">
                <TextArea
                  rows={2}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="leave empty for built-in CS prompt"
                />
              </Form.Item>

              <Form.Item label="User message">
                <TextArea
                  rows={3}
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                />
              </Form.Item>

              <Space>
                <Button type="primary" loading={replyLoading} onClick={handleTestReply}>
                  Send
                </Button>
                <Tooltip title="Clears Redis conversation context for this chatId">
                  <Button size="small" onClick={handleClearHistory}>Clear context</Button>
                </Tooltip>
              </Space>

              {replyResult && (
                <Card
                  size="small"
                  style={{ marginTop: 16, background: '#f5f5f5' }}
                  title={
                    <Space size={8}>
                      <Tag color="blue">{replyResult.provider}</Tag>
                      <Text code style={{ fontSize: 11 }}>{replyResult.model}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{replyResult.tokens} tokens</Text>
                    </Space>
                  }
                >
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {replyResult.reply}
                  </Paragraph>
                </Card>
              )}
            </Form>
          </Card>

          <Card
            title={
              <Space>
                <span>FAQ Quick Answer</span>
                <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                  test /ai/faq (no conversation history)
                </Text>
              </Space>
            }
          >
            <Form layout="vertical">
              <Form.Item label="Question">
                <Input value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} />
              </Form.Item>
              <Form.Item label="Context (optional)">
                <TextArea
                  rows={2}
                  value={faqContext}
                  onChange={(e) => setFaqContext(e.target.value)}
                  placeholder="extra context the AI should consider"
                />
              </Form.Item>
              <Button type="primary" loading={faqLoading} onClick={handleTestFaq}>
                Get Answer
              </Button>
              {faqResult && (
                <Card
                  size="small"
                  style={{ marginTop: 16, background: '#f5f5f5' }}
                  title={
                    <Space size={8}>
                      <Tag color="blue">{faqResult.provider}</Tag>
                      <Text code style={{ fontSize: 11 }}>{faqResult.model}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{faqResult.tokens} tokens</Text>
                    </Space>
                  }
                >
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {faqResult.answer}
                  </Paragraph>
                </Card>
              )}
            </Form>
          </Card>
        </>
      )}
    </div>
  );
}
