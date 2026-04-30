import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { knowledgeApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Sider, Content } = Layout;

type KbType = 'product' | 'pricing' | 'presales_faq' | 'support_faq' | 'company' | 'ad_material' | 'guardrail';
type FaqSource = 'manual' | 'ai_generated' | 'imported';
type SourceKind = 'txt' | 'md' | 'pdf' | 'docx' | 'manual' | 'url';
type SourceStatus = 'pending' | 'processed' | 'failed';
type ProtectedType = 'phone' | 'email' | 'url' | 'company' | 'address';

interface Kb {
  id: string;
  name: string;
  type: KbType;
  description: string | null;
  goalPrompt: string | null;
  isDefault: boolean;
  enabled: boolean;
}

interface Faq {
  id: string;
  kbId: string;
  question: string;
  answer: string;
  source: FaqSource;
  tags: string[] | null;
  hitCount: number;
  enabled: boolean;
}

interface KbSource {
  id: string;
  kbId: string;
  fileName: string;
  kind: SourceKind;
  byteSize: number;
  status: SourceStatus;
  errorMsg: string | null;
  processedAt: string | null;
  createdAt: string;
}

interface KbProtectedEntity {
  id: string;
  kbId: string;
  entityType: ProtectedType;
  value: string;
  createdAt: string;
}

const KB_TYPE_META: Record<KbType, { label: string; color: string }> = {
  product:      { label: '产品资料',         color: 'blue' },
  pricing:      { label: '价格 / 套餐',       color: 'gold' },
  presales_faq: { label: '售前 FAQ',          color: 'green' },
  support_faq:  { label: '售后 FAQ',          color: 'cyan' },
  company:      { label: '公司介绍',          color: 'purple' },
  ad_material:  { label: '广告素材',          color: 'magenta' },
  guardrail:    { label: '风控 / 禁答规则',   color: 'red' },
};

const PROTECTED_META: Record<ProtectedType, { label: string; color: string }> = {
  phone:   { label: '电话', color: 'blue' },
  email:   { label: '邮箱', color: 'purple' },
  url:     { label: '网址', color: 'cyan' },
  company: { label: '公司', color: 'gold' },
  address: { label: '地址', color: 'green' },
};

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function KnowledgePage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [protectedEntities, setProtectedEntities] = useState<KbProtectedEntity[]>([]);

  const [kbsLoading, setKbsLoading] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'docs' | 'faqs' | 'protected'>('docs');

  const [kbModal, setKbModal] = useState<{ open: boolean; editing: Kb | null }>({ open: false, editing: null });
  const [kbForm] = Form.useForm<{ name: string; type: KbType; description?: string; goalPrompt?: string; isDefault?: boolean }>();

  const [faqModal, setFaqModal] = useState<{ open: boolean; editing: Faq | null }>({ open: false, editing: null });
  const [faqForm] = Form.useForm<{ question: string; answer: string; tags?: string[]; enabled?: boolean }>();

  const [protectedForm] = Form.useForm<{ entityType: ProtectedType; value: string }>();
  const [generating, setGenerating] = useState(false);

  const selectedKb = useMemo(() => kbs.find((k) => k.id === selectedKbId) ?? null, [kbs, selectedKbId]);

  const loadKbs = useCallback(async () => {
    setKbsLoading(true);
    try {
      const res = await knowledgeApi.listKbs();
      const list: Kb[] = Array.isArray(res.data) ? res.data : [];
      setKbs(list);
      if (list.length && !selectedKbId) {
        const def = list.find((k) => k.isDefault) ?? list[0];
        setSelectedKbId(def.id);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载知识库失败');
    } finally {
      setKbsLoading(false);
    }
  }, [selectedKbId]);

  const loadTabData = useCallback(async (kbId: string) => {
    setTabLoading(true);
    try {
      const [faqsRes, sourcesRes, protectedRes] = await Promise.all([
        knowledgeApi.listFaqs({ kbId }),
        knowledgeApi.listSources(kbId),
        knowledgeApi.listProtected(kbId),
      ]);
      setFaqs(Array.isArray(faqsRes.data) ? faqsRes.data : []);
      setSources(Array.isArray(sourcesRes.data) ? sourcesRes.data : []);
      setProtectedEntities(Array.isArray(protectedRes.data) ? protectedRes.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setTabLoading(false);
    }
  }, []);

  useEffect(() => { void loadKbs(); }, [loadKbs]);
  useEffect(() => {
    if (selectedKbId) void loadTabData(selectedKbId);
  }, [selectedKbId, loadTabData]);

  // === KB ===
  const openKbModal = (editing: Kb | null) => {
    kbForm.resetFields();
    if (editing) {
      kbForm.setFieldsValue({
        name: editing.name,
        type: editing.type,
        description: editing.description ?? '',
        goalPrompt: editing.goalPrompt ?? '',
        isDefault: editing.isDefault,
      });
    } else {
      kbForm.setFieldsValue({ type: 'presales_faq', isDefault: false });
    }
    setKbModal({ open: true, editing });
  };

  const submitKb = async (values: any) => {
    try {
      if (kbModal.editing) {
        await knowledgeApi.updateKb(kbModal.editing.id, values);
        antdMessage.success('知识库已更新');
      } else {
        const res = await knowledgeApi.createKb(values);
        setSelectedKbId(res.data?.id ?? null);
        antdMessage.success('知识库已创建');
      }
      setKbModal({ open: false, editing: null });
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    }
  };

  const removeKb = async (id: string) => {
    try {
      await knowledgeApi.deleteKb(id);
      antdMessage.success('已删除');
      if (selectedKbId === id) setSelectedKbId(null);
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const toggleDefault = async (kb: Kb) => {
    try {
      await knowledgeApi.updateKb(kb.id, { isDefault: !kb.isDefault });
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
    }
  };

  // === FAQ ===
  const openFaqModal = (editing: Faq | null) => {
    faqForm.resetFields();
    if (editing) {
      faqForm.setFieldsValue({
        question: editing.question,
        answer: editing.answer,
        tags: editing.tags ?? [],
        enabled: editing.enabled,
      });
    } else {
      faqForm.setFieldsValue({ enabled: true, tags: [] });
    }
    setFaqModal({ open: true, editing });
  };

  const submitFaq = async (values: any) => {
    if (!selectedKbId) return;
    try {
      if (faqModal.editing) {
        await knowledgeApi.updateFaq(faqModal.editing.id, values);
        antdMessage.success('FAQ 已更新');
      } else {
        await knowledgeApi.createFaq({ ...values, kbId: selectedKbId, source: 'manual' });
        antdMessage.success('FAQ 已添加');
      }
      setFaqModal({ open: false, editing: null });
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    }
  };

  const removeFaq = async (id: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteFaq(id);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  // === Source ===
  const uploadProps: UploadProps = useMemo(() => ({
    name: 'file',
    multiple: false,
    showUploadList: false,
    accept: '.txt,.md,.pdf,.docx',
    beforeUpload: async (file) => {
      if (!selectedKbId) {
        antdMessage.warning('请先选择一个知识库');
        return Upload.LIST_IGNORE;
      }
      try {
        const res = await knowledgeApi.uploadSource(selectedKbId, file as File);
        if (res.data?.status === 'failed') {
          antdMessage.error(`上传失败: ${res.data.errorMsg ?? 'unknown'}`);
        } else {
          antdMessage.success(`已处理 ${file.name}`);
        }
        void loadTabData(selectedKbId);
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? '上传失败');
      }
      return Upload.LIST_IGNORE;
    },
  }), [selectedKbId, loadTabData]);

  const removeSource = async (srcId: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteSource(selectedKbId, srcId);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const generateFaqs = async () => {
    if (!selectedKbId) return;
    if (sources.filter((s) => s.status === 'processed').length === 0) {
      antdMessage.warning('请先上传至少一个文档');
      return;
    }
    setGenerating(true);
    try {
      const res = await knowledgeApi.generateFaqs(selectedKbId, 30);
      antdMessage.success(`AI 生成了 ${res.data?.generated ?? 0} 条 FAQ`);
      void loadTabData(selectedKbId);
      setActiveTab('faqs');
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请检查 AI Settings');
    } finally {
      setGenerating(false);
    }
  };

  // === Protected ===
  const submitProtected = async (values: any) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.addProtected(selectedKbId, values.entityType, values.value);
      protectedForm.resetFields();
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '添加失败');
    }
  };

  const removeProtected = async (entId: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteProtected(selectedKbId, entId);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const faqColumns: ColumnsType<Faq> = [
    {
      title: '问题', dataIndex: 'question', key: 'question',
      render: (q: string, row) => (
        <div>
          <Text strong>{q}</Text>
          <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }} ellipsis={{ rows: 2 }}>
            {row.answer}
          </Paragraph>
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'enabled', key: 'enabled', width: 80,
      render: (e: boolean) => e ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 100,
      render: (s: FaqSource) => {
        const map = {
          manual: { label: '手动', color: 'default' },
          ai_generated: { label: 'AI 生成', color: 'purple' },
          imported: { label: '批量', color: 'blue' },
        };
        const m = map[s];
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    { title: '命中', dataIndex: 'hitCount', key: 'hitCount', width: 70 },
    {
      title: '操作', key: 'ops', width: 130,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openFaqModal(row)} />
          <Popconfirm title="确认删除？" onConfirm={() => removeFaq(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ background: 'transparent' }}>
      <Sider
        width={260}
        style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0', padding: 8, marginRight: 16 }}
      >
        <Button type="primary" block icon={<PlusOutlined />} onClick={() => openKbModal(null)} style={{ marginBottom: 8 }}>
          新建知识库
        </Button>
        <List
          loading={kbsLoading}
          dataSource={kbs}
          locale={{ emptyText: <Empty description="尚无知识库" /> }}
          renderItem={(kb) => {
            const meta = KB_TYPE_META[kb.type];
            const active = kb.id === selectedKbId;
            const faqCount = kb.id === selectedKbId ? faqs.length : undefined;
            const docCount = kb.id === selectedKbId ? sources.length : undefined;
            return (
              <Card
                key={kb.id}
                size="small"
                onClick={() => setSelectedKbId(kb.id)}
                hoverable
                style={{
                  marginBottom: 6,
                  border: active ? '2px solid #1677ff' : '1px solid #f0f0f0',
                  background: active ? '#e6f4ff' : '#fff',
                  cursor: 'pointer',
                }}
                styles={{ body: { padding: 10 } }}
              >
                <Space size={4} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space size={6}>
                    <FileTextOutlined style={{ color: meta.color === 'red' ? '#cf1322' : '#1677ff' }} />
                    <Text strong style={{ fontSize: 13 }}>{kb.name}</Text>
                    {kb.isDefault && <StarFilled style={{ color: '#faad14', fontSize: 12 }} />}
                  </Space>
                  <Tooltip title={kb.isDefault ? '取消默认' : '设为默认 (公司通用)'}>
                    <Button
                      type="text"
                      size="small"
                      icon={kb.isDefault ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                      onClick={(e) => { e.stopPropagation(); void toggleDefault(kb); }}
                    />
                  </Tooltip>
                </Space>
                <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
                  <Tag color={meta.color} style={{ marginRight: 4, fontSize: 10 }}>{meta.label}</Tag>
                  {docCount !== undefined && <span>{docCount} 文档 · {faqCount} FAQ</span>}
                </div>
              </Card>
            );
          }}
        />
      </Sider>

      <Content>
        {!selectedKb ? (
          <Empty description="请先创建或选择一个知识库" style={{ marginTop: 80 }} />
        ) : (
          <div>
            <Card style={{ marginBottom: 12 }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div>
                  <Space>
                    <Title level={4} style={{ margin: 0 }}>
                      <BookOutlined style={{ marginRight: 8 }} />
                      {selectedKb.name}
                    </Title>
                    {selectedKb.isDefault && <Tag color="gold" icon={<StarFilled />}>默认 · 公司通用</Tag>}
                    <Tag color={KB_TYPE_META[selectedKb.type].color}>
                      {KB_TYPE_META[selectedKb.type].label}
                    </Tag>
                  </Space>
                  {selectedKb.description && (
                    <Paragraph type="secondary" style={{ margin: '6px 0 0' }}>{selectedKb.description}</Paragraph>
                  )}
                </div>
                <Space>
                  <Button icon={<EditOutlined />} onClick={() => openKbModal(selectedKb)}>编辑</Button>
                  <Popconfirm title={`确认删除「${selectedKb.name}」？`} onConfirm={() => removeKb(selectedKb.id)}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              </Space>
              <Card type="inner" size="small" style={{ marginTop: 12, background: '#f0fbf3' }}>
                <Text strong style={{ fontSize: 13 }}>业务目标</Text>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                  AI 回复时的终极目标，会被带入每次对话 prompt
                </Text>
                <Paragraph style={{ margin: '6px 0 0' }}>
                  {selectedKb.goalPrompt || <Text type="secondary">尚未设置（点「编辑」添加）</Text>}
                </Paragraph>
              </Card>
            </Card>

            <Card loading={tabLoading}>
              <Tabs
                activeKey={activeTab}
                onChange={(k) => setActiveTab(k as any)}
                items={[
                  {
                    key: 'docs',
                    label: <span><FileTextOutlined /> 文档 ({sources.length})</span>,
                    children: (
                      <div>
                        <Upload.Dragger {...uploadProps} style={{ marginBottom: 16 }}>
                          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                          <p className="ant-upload-text">拖拽文件到这里，或点击选择</p>
                          <p className="ant-upload-hint">支持 txt / md / PDF / docx · 最大 20 MB</p>
                        </Upload.Dragger>

                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message="上传后系统自动做 3 件事"
                          description={
                            <Text style={{ fontSize: 12 }}>
                              ① 解析文本 ② 抽取电话/邮箱/网址（自动加入「保留实体」）③ 等待你点 AI 生成 FAQ
                            </Text>
                          }
                        />

                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={generating}
                          onClick={generateFaqs}
                          disabled={sources.filter((s) => s.status === 'processed').length === 0}
                          style={{ marginBottom: 12 }}
                        >
                          AI 生成 30 条 FAQ
                        </Button>

                        <Table
                          dataSource={sources}
                          rowKey="id"
                          size="small"
                          pagination={false}
                          locale={{ emptyText: <Empty description="尚未上传文档" /> }}
                          columns={[
                            { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
                            { title: '类型', dataIndex: 'kind', key: 'kind', width: 70,
                              render: (k: string) => <Tag>{k}</Tag> },
                            { title: '大小', dataIndex: 'byteSize', key: 'byteSize', width: 90,
                              render: (n: number) => fmtBytes(n) },
                            { title: '状态', dataIndex: 'status', key: 'status', width: 100,
                              render: (s: SourceStatus, row) =>
                                s === 'processed'
                                  ? <Badge status="success" text="已处理" />
                                  : s === 'failed'
                                    ? <Tooltip title={row.errorMsg}><Badge status="error" text="失败" /></Tooltip>
                                    : <Badge status="processing" text="处理中" /> },
                            { title: '上传时间', dataIndex: 'createdAt', key: 'createdAt', width: 160,
                              render: (t: string) => new Date(t).toLocaleString() },
                            { title: '操作', key: 'ops', width: 80,
                              render: (_, row) => (
                                <Popconfirm title="确认删除？" onConfirm={() => removeSource(row.id)}>
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              ) },
                          ]}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'faqs',
                    label: <span>FAQ ({faqs.length})</span>,
                    children: (
                      <div>
                        <Space style={{ marginBottom: 12 }}>
                          <Button type="primary" icon={<PlusOutlined />} onClick={() => openFaqModal(null)}>手动添加</Button>
                          <Button icon={<ThunderboltOutlined />} loading={generating} onClick={generateFaqs}>AI 生成 30 条</Button>
                          <Button icon={<ReloadOutlined />} onClick={() => selectedKbId && loadTabData(selectedKbId)}>刷新</Button>
                        </Space>
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message="FAQ 是客户自动回复的优先来源 · 命中就直接回 · 没有的问题再走 AI"
                        />
                        <Table
                          dataSource={faqs}
                          columns={faqColumns}
                          rowKey="id"
                          size="small"
                          pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'protected',
                    label: <span><SafetyOutlined /> 保留实体 ({protectedEntities.length})</span>,
                    children: (
                      <div>
                        <Alert
                          type="info"
                          showIcon
                          message="AI 回复保留这些实体不改"
                          description="上传文档时系统自动抽取电话/邮箱/网址。AI 生成回复及变体时必须原样保留，不能篡改。"
                          style={{ marginBottom: 16 }}
                        />
                        <Form layout="inline" form={protectedForm} onFinish={submitProtected} style={{ marginBottom: 16 }}>
                          <Form.Item name="entityType" initialValue="phone" rules={[{ required: true }]}>
                            <Select style={{ width: 100 }} options={Object.entries(PROTECTED_META).map(([k, v]) => ({ value: k, label: v.label }))} />
                          </Form.Item>
                          <Form.Item name="value" rules={[{ required: true, message: '请输入值' }]} style={{ flex: 1, minWidth: 240 }}>
                            <Input placeholder="例: 60123456789 / sales@example.com / https://..." />
                          </Form.Item>
                          <Form.Item>
                            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>手动添加</Button>
                          </Form.Item>
                        </Form>
                        <Table
                          dataSource={protectedEntities}
                          rowKey="id"
                          size="small"
                          pagination={false}
                          locale={{ emptyText: <Empty description="尚无保留实体" /> }}
                          columns={[
                            { title: '类型', dataIndex: 'entityType', key: 'entityType', width: 100,
                              render: (t: ProtectedType) => {
                                const m = PROTECTED_META[t];
                                return <Tag color={m.color}>{m.label}</Tag>;
                              } },
                            { title: '值', dataIndex: 'value', key: 'value' },
                            { title: '操作', key: 'ops', width: 80,
                              render: (_, row) => (
                                <Popconfirm title="确认删除？" onConfirm={() => removeProtected(row.id)}>
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              ) },
                          ]}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        )}
      </Content>

      {/* KB Modal */}
      <Modal
        title={kbModal.editing ? `编辑「${kbModal.editing.name}」` : '新建知识库'}
        open={kbModal.open}
        onCancel={() => setKbModal({ open: false, editing: null })}
        onOk={() => kbForm.submit()}
        destroyOnClose
        width={600}
      >
        <Form form={kbForm} layout="vertical" onFinish={submitKb}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如：产品 X / 公司通用" />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={Object.entries(KB_TYPE_META).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input placeholder="一行简介" />
          </Form.Item>
          <Form.Item name="goalPrompt" label="业务目标（AI 回复的终极目的）" extra="例：让客户了解本公司服务和联系方式，引导咨询或预约">
            <TextArea rows={3} placeholder="留空则使用默认 prompt" />
          </Form.Item>
          <Form.Item name="isDefault" label="设为默认（公司通用）" valuePropName="checked" extra="默认 KB 用于产品名未匹配时的兜底回复">
            <Select
              options={[
                { value: false, label: '不是默认' },
                { value: true,  label: '设为默认 (替换现有默认)' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* FAQ Modal */}
      <Modal
        title={faqModal.editing ? '编辑 FAQ' : '添加 FAQ'}
        open={faqModal.open}
        onCancel={() => setFaqModal({ open: false, editing: null })}
        onOk={() => faqForm.submit()}
        destroyOnClose
        width={640}
      >
        <Form form={faqForm} layout="vertical" onFinish={submitFaq}>
          <Form.Item name="question" label="问题" rules={[{ required: true }]}>
            <Input placeholder="客户口吻：你们……" />
          </Form.Item>
          <Form.Item name="answer" label="答案" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="保留电话/邮箱等具体信息" />
          </Form.Item>
          <Form.Item name="tags" label="Tags">
            <Select mode="tags" tokenSeparators={[',']} placeholder="如：pricing, contact" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Select options={[{ value: true, label: '启用' }, { value: false, label: '停用' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
