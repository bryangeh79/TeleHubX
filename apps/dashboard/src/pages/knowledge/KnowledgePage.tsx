import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dropdown,
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
import { useT } from '../../i18n';

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
  // i18n V1
  language?: string;       // zh / en / ms / vi (default zh)
  status?: string;         // 'draft' | 'published' (default published)
  translatedFromId?: string | null;
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

function buildKbTypeMeta(t: (k: string) => string): Record<KbType, { label: string; color: string }> {
  return {
    product:      { label: t('kb.type.product'),      color: 'blue' },
    pricing:      { label: t('kb.type.pricing'),      color: 'gold' },
    presales_faq: { label: t('kb.type.presales_faq'), color: 'green' },
    support_faq:  { label: t('kb.type.support_faq'),  color: 'cyan' },
    company:      { label: t('kb.type.company'),      color: 'purple' },
    ad_material:  { label: t('kb.type.ad_material'),  color: 'magenta' },
    guardrail:    { label: t('kb.type.guardrail'),    color: 'red' },
  };
}

function buildProtectedMeta(t: (k: string) => string): Record<ProtectedType, { label: string; color: string }> {
  return {
    phone:   { label: t('kb.entity.phone'),   color: 'blue' },
    email:   { label: t('kb.entity.email'),   color: 'purple' },
    url:     { label: t('kb.entity.url'),     color: 'cyan' },
    company: { label: t('kb.entity.company'), color: 'gold' },
    address: { label: t('kb.entity.address'), color: 'green' },
  };
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export default function KnowledgePage() {
  const t = useT();
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
  const KB_TYPE_META = buildKbTypeMeta(t);

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
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
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
        antdMessage.success(t('kb.kbUpdated'));
      } else {
        const res = await knowledgeApi.createKb(values);
        setSelectedKbId(res.data?.id ?? null);
        antdMessage.success(t('kb.kbCreated'));
      }
      setKbModal({ open: false, editing: null });
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    }
  };

  const removeKb = async (id: string) => {
    try {
      await knowledgeApi.deleteKb(id);
      antdMessage.success(t('msg.deleted'));
      if (selectedKbId === id) setSelectedKbId(null);
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
    }
  };

  const toggleDefault = async (kb: Kb) => {
    try {
      await knowledgeApi.updateKb(kb.id, { isDefault: !kb.isDefault });
      void loadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
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
        antdMessage.success(t('kb.faqUpdated'));
      } else {
        await knowledgeApi.createFaq({ ...values, kbId: selectedKbId, source: 'manual' });
        antdMessage.success(t('kb.faqAdded'));
      }
      setFaqModal({ open: false, editing: null });
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    }
  };

  const removeFaq = async (id: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteFaq(id);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
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
        antdMessage.warning(t('kb.uploadPickKb'));
        return Upload.LIST_IGNORE;
      }
      try {
        const res = await knowledgeApi.uploadSource(selectedKbId, file as File);
        if (res.data?.status === 'failed') {
          antdMessage.error(t('kb.uploadFail', { msg: res.data.errorMsg ?? 'unknown' }));
        } else {
          antdMessage.success(t('kb.uploadOk', { name: file.name }));
        }
        void loadTabData(selectedKbId);
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? t('kb.uploadGenericFail'));
      }
      return Upload.LIST_IGNORE;
    },
  }), [selectedKbId, loadTabData, t]);

  const removeSource = async (srcId: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteSource(selectedKbId, srcId);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
    }
  };

  const generateFaqs = async () => {
    if (!selectedKbId) return;
    if (sources.filter((s) => s.status === 'processed').length === 0) {
      antdMessage.warning(t('kb.aiNeedDoc'));
      return;
    }
    setGenerating(true);
    try {
      const res = await knowledgeApi.generateFaqs(selectedKbId, 30);
      antdMessage.success(t('kb.aiOk', { n: res.data?.generated ?? 0 }));
      void loadTabData(selectedKbId);
      setActiveTab('faqs');
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('kb.aiFail'));
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
      antdMessage.error(err?.response?.data?.message ?? t('kb.faqAddFail'));
    }
  };

  const removeProtected = async (entId: string) => {
    if (!selectedKbId) return;
    try {
      await knowledgeApi.deleteProtected(selectedKbId, entId);
      void loadTabData(selectedKbId);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
    }
  };

  const faqColumns: ColumnsType<Faq> = [
    {
      title: t('kb.faq.col.q'), dataIndex: 'question', key: 'question',
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
      title: t('kb.faq.col.status'), dataIndex: 'enabled', key: 'enabled', width: 80,
      render: (e: boolean) => e ? <Tag color="green">{t('kb.faq.tag.enabled')}</Tag> : <Tag>{t('kb.faq.tag.disabled')}</Tag>,
    },
    {
      title: t('kb.faq.col.source'), dataIndex: 'source', key: 'source', width: 100,
      render: (s: FaqSource) => {
        const map = {
          manual: { label: t('kb.faq.src.manual'), color: 'default' },
          ai_generated: { label: t('kb.faq.src.ai'), color: 'purple' },
          imported: { label: t('kb.faq.src.imported'), color: 'blue' },
        };
        const m = map[s];
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    { title: t('kb.faq.col.hits'), dataIndex: 'hitCount', key: 'hitCount', width: 70 },
    {
      title: t('kb.faq.col.lang'), dataIndex: 'language', key: 'language', width: 100,
      render: (lng?: string, row?: Faq) => {
        const l = lng ?? 'zh';
        const s = row?.status ?? 'published';
        return (
          <Space size={4}>
            <Tag color={l === 'zh' ? 'red' : l === 'en' ? 'blue' : l === 'ms' ? 'green' : 'gold'}>{l.toUpperCase()}</Tag>
            {s === 'draft' && <Tag color="orange">{t('kb.faq.tag.draft')}</Tag>}
          </Space>
        );
      },
    },
    {
      title: t('kb.faq.col.actions'), key: 'ops', width: 220,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openFaqModal(row)} />
          {(row.status ?? 'published') === 'draft' && (
            <Popconfirm title={t('kb.faq.publishConfirm')} onConfirm={async () => {
              try {
                await knowledgeApi.publishFaq(row.id);
                antdMessage.success(t('kb.faq.publishOk'));
                if (selectedKbId) loadTabData(selectedKbId);
              } catch (e: any) { antdMessage.error(e?.response?.data?.message ?? t('kb.faq.publishFail')); }
            }}>
              <Button size="small" type="primary" ghost>{t('kb.faq.publish')}</Button>
            </Popconfirm>
          )}
          {(row.status ?? 'published') === 'published' && (
            <TranslateFaqDropdown faq={row} onDone={() => selectedKbId && loadTabData(selectedKbId)} />
          )}
          <Popconfirm title={t('kb.faq.delConfirm')} onConfirm={() => removeFaq(row.id)}>
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
          {t('kb.btnNew')}
        </Button>
        <List
          loading={kbsLoading}
          dataSource={kbs}
          locale={{ emptyText: <Empty description={t('kb.empty')} /> }}
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
                  <Tooltip title={kb.isDefault ? t('kb.tooltipDefaultOff') : t('kb.tooltipDefaultOn')}>
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
                  {docCount !== undefined && <span>{t('kb.docCount', { docs: docCount, faqs: faqCount ?? 0 })}</span>}
                </div>
              </Card>
            );
          }}
        />
      </Sider>

      <Content>
        {!selectedKb ? (
          <Empty description={t('kb.emptySelect')} style={{ marginTop: 80 }} />
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
                    {selectedKb.isDefault && <Tag color="gold" icon={<StarFilled />}>{t('kb.tag.default')}</Tag>}
                    <Tag color={KB_TYPE_META[selectedKb.type].color}>
                      {KB_TYPE_META[selectedKb.type].label}
                    </Tag>
                  </Space>
                  {selectedKb.description && (
                    <Paragraph type="secondary" style={{ margin: '6px 0 0' }}>{selectedKb.description}</Paragraph>
                  )}
                </div>
                <Space>
                  <Button icon={<EditOutlined />} onClick={() => openKbModal(selectedKb)}>{t('kb.btnEdit')}</Button>
                  <Popconfirm title={t('kb.delConfirm', { name: selectedKb.name })} onConfirm={() => removeKb(selectedKb.id)}>
                    <Button danger icon={<DeleteOutlined />}>{t('kb.btnDelete')}</Button>
                  </Popconfirm>
                </Space>
              </Space>
              <Card type="inner" size="small" style={{ marginTop: 12, background: '#f0fbf3' }}>
                <Text strong style={{ fontSize: 13 }}>{t('kb.goalLabel')}</Text>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                  {t('kb.goalDesc')}
                </Text>
                <Paragraph style={{ margin: '6px 0 0' }}>
                  {selectedKb.goalPrompt || <Text type="secondary">{t('kb.goalEmpty')}</Text>}
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
                    label: <span><FileTextOutlined /> {t('kb.tab.docs')} ({sources.length})</span>,
                    children: (
                      <div>
                        <Upload.Dragger {...uploadProps} style={{ marginBottom: 16 }}>
                          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                          <p className="ant-upload-text">{t('kb.upload.dragText')}</p>
                          <p className="ant-upload-hint">{t('kb.upload.hint')}</p>
                        </Upload.Dragger>

                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={generating}
                          onClick={generateFaqs}
                          disabled={sources.filter((s) => s.status === 'processed').length === 0}
                          style={{ marginBottom: 12 }}
                        >
                          {t('kb.aiGenerateFaqs')}
                        </Button>

                        <Table
                          dataSource={sources}
                          rowKey="id"
                          size="small"
                          pagination={false}
                          locale={{ emptyText: <Empty description={t('common.none')} /> }}
                          columns={[
                            { title: t('kb.col.fileName'), dataIndex: 'fileName', key: 'fileName' },
                            { title: t('common.type'), dataIndex: 'kind', key: 'kind', width: 70,
                              render: (k: string) => <Tag>{k}</Tag> },
                            { title: t('kb.col.size'), dataIndex: 'byteSize', key: 'byteSize', width: 90,
                              render: (n: number) => fmtBytes(n) },
                            { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
                              render: (s: SourceStatus, row) =>
                                s === 'processed'
                                  ? <Badge status="success" text={t('kb.source.processed')} />
                                  : s === 'failed'
                                    ? <Tooltip title={row.errorMsg}><Badge status="error" text={t('common.failed')} /></Tooltip>
                                    : <Badge status="processing" text={t('common.running')} /> },
                            { title: t('common.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 160,
                              render: (tt: string) => new Date(tt).toLocaleString() },
                            { title: t('common.actions'), key: 'ops', width: 80,
                              render: (_, row) => (
                                <Popconfirm title={t('common.confirmDelete')} onConfirm={() => removeSource(row.id)}>
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
                          <Button type="primary" icon={<PlusOutlined />} onClick={() => openFaqModal(null)}>{t('common.add')}</Button>
                          <Button icon={<ThunderboltOutlined />} loading={generating} onClick={generateFaqs}>{t('kb.aiGenerateFaqs')}</Button>
                          <Button icon={<ReloadOutlined />} onClick={() => selectedKbId && loadTabData(selectedKbId)}>{t('common.refresh')}</Button>
                        </Space>
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
                  // 「保留实体」tab 已隐藏 — 系统自动从文档抽取电话/邮箱/网址保护，无需租户手动维护
                ]}
              />
            </Card>
          </div>
        )}
      </Content>

      {/* KB Modal */}
      <Modal
        title={kbModal.editing ? t('modal.kb.edit') : t('modal.kb.add')}
        open={kbModal.open}
        onCancel={() => setKbModal({ open: false, editing: null })}
        onOk={() => kbForm.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
        width={600}
      >
        <Form form={kbForm} layout="vertical" onFinish={submitKb}>
          <Form.Item name="name" label={t('common.name')} rules={[{ required: true, message: t('form.required') }]}>
            <Input placeholder={t('form.placeholder.required')} />
          </Form.Item>
          <Form.Item name="type" label={t('common.type')} rules={[{ required: true, message: t('form.required') }]}>
            <Select options={Object.entries(KB_TYPE_META).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Form.Item>
          <Form.Item name="description" label={t('form.description')}>
            <Input placeholder={t('form.placeholder.optional')} />
          </Form.Item>
          <Form.Item name="goalPrompt" label="Goal Prompt">
            <TextArea rows={3} placeholder={t('form.placeholder.optional')} />
          </Form.Item>
          <Form.Item name="isDefault" label={t('common.default') || 'Default'} valuePropName="checked">
            <Select
              options={[
                { value: false, label: t('common.no') },
                { value: true,  label: t('common.yes') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* FAQ Modal */}
      <Modal
        title={faqModal.editing ? t('modal.faq.edit') : t('modal.faq.add')}
        open={faqModal.open}
        onCancel={() => setFaqModal({ open: false, editing: null })}
        onOk={() => faqForm.submit()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
        width={640}
      >
        <Form form={faqForm} layout="vertical" onFinish={submitFaq}>
          <Form.Item name="question" label={t('form.question')} rules={[{ required: true, message: t('form.required') }]}>
            <Input placeholder={t('form.placeholder.required')} />
          </Form.Item>
          <Form.Item name="answer" label={t('form.answer')} rules={[{ required: true, message: t('form.required') }]}>
            <TextArea rows={4} placeholder={t('form.placeholder.required')} />
          </Form.Item>
          <Form.Item name="tags" label={t('form.tags')}>
            <Select mode="tags" tokenSeparators={[',']} placeholder={t('form.placeholder.optional')} />
          </Form.Item>
          <Form.Item name="enabled" label={t('common.enable')} valuePropName="checked">
            <Select options={[{ value: true, label: t('common.enabled') }, { value: false, label: t('common.disabled') }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}


// ── i18n V1: FAQ 翻译草稿下拉按钮 (Issue #1 Task C) ─────────────────────
function TranslateFaqDropdown({ faq, onDone }: { faq: Faq; onDone: () => void }) {
  const t = useT();
  const [loading, setLoading] = useState(false);

  const handleTranslate = async (target: 'zh' | 'en' | 'ms' | 'vi') => {
    if ((faq.language ?? 'zh') === target) {
      antdMessage.warning(t('kb.tx.alreadyLang', { lang: target.toUpperCase() }));
      return;
    }
    setLoading(true);
    antdMessage.loading({ content: t('kb.tx.translating', { lang: target.toUpperCase() }), key: 'translate', duration: 0 });
    try {
      await knowledgeApi.translateFaqDraft(faq.id, target, faq.language ?? 'zh');
      antdMessage.success({ content: t('kb.tx.draftOk', { lang: target.toUpperCase() }), key: 'translate' });
      onDone();
    } catch (e: any) {
      antdMessage.error({
        content: e?.response?.data?.message ?? t('kb.tx.draftFail', { lang: target.toUpperCase() }),
        key: 'translate',
      });
    } finally {
      setLoading(false);
    }
  };

  const items = [
    { key: 'zh', label: t('kb.tx.menuZh'), disabled: (faq.language ?? 'zh') === 'zh' },
    { key: 'en', label: t('kb.tx.menuEn'), disabled: (faq.language ?? 'zh') === 'en' },
    { key: 'ms', label: t('kb.tx.menuMs'), disabled: (faq.language ?? 'zh') === 'ms' },
    { key: 'vi', label: t('kb.tx.menuVi'), disabled: (faq.language ?? 'zh') === 'vi' },
  ];

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => handleTranslate(key as any),
      }}
      trigger={['click']}
      disabled={loading}
    >
      <Button size="small" loading={loading}>{t('kb.tx.btn')}</Button>
    </Dropdown>
  );
}
