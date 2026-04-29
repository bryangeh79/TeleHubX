import { useEffect, useState, useCallback } from 'react';
import {
  Layout,
  Menu,
  Card,
  Table,
  Button,
  Input,
  Modal,
  Form,
  Select,
  Tag,
  Space,
  Typography,
  Empty,
  Popconfirm,
  Tooltip,
  message as antdMessage,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  BookOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { knowledgeApi } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Sider, Content } = Layout;

type KbType = 'product' | 'pricing' | 'presales_faq' | 'support_faq' | 'company' | 'ad_material' | 'guardrail';
type FaqSource = 'manual' | 'ai_generated' | 'imported';

interface Kb {
  id: string;
  name: string;
  type: KbType;
  description: string | null;
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

const KB_TYPE_META: Record<KbType, { label: string; color: string }> = {
  product:      { label: '产品资料',          color: 'blue' },
  pricing:      { label: '价格 / 套餐',       color: 'gold' },
  presales_faq: { label: '售前 FAQ',         color: 'green' },
  support_faq: { label: '售后 FAQ',          color: 'cyan' },
  company:      { label: '公司介绍',          color: 'purple' },
  ad_material:  { label: '广告素材',          color: 'magenta' },
  guardrail:    { label: '风控 / 禁答规则',   color: 'red' },
};

export default function KnowledgePage() {
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [kbsLoading, setKbsLoading] = useState(false);
  const [faqsLoading, setFaqsLoading] = useState(false);

  const [kbModal, setKbModal] = useState<{ open: boolean; editing: Kb | null }>({ open: false, editing: null });
  const [kbForm] = Form.useForm<{ name: string; type: KbType; description?: string }>();
  const [faqModal, setFaqModal] = useState<{ open: boolean; editing: Faq | null }>({ open: false, editing: null });
  const [faqForm] = Form.useForm<{ question: string; answer: string; tags?: string[]; enabled?: boolean }>();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ faq: Faq; score: number }> | null>(null);

  const reloadKbs = useCallback(async () => {
    setKbsLoading(true);
    try {
      const res = await knowledgeApi.listKbs();
      const list: Kb[] = Array.isArray(res.data) ? res.data : [];
      setKbs(list);
      if (!selectedKbId && list.length) setSelectedKbId(list[0].id);
      if (selectedKbId && !list.some(k => k.id === selectedKbId)) {
        setSelectedKbId(list[0]?.id ?? null);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load KBs');
    } finally {
      setKbsLoading(false);
    }
  }, [selectedKbId]);

  const reloadFaqs = useCallback(async () => {
    if (!selectedKbId) {
      setFaqs([]);
      return;
    }
    setFaqsLoading(true);
    try {
      const res = await knowledgeApi.listFaqs({ kbId: selectedKbId });
      setFaqs(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load FAQs');
    } finally {
      setFaqsLoading(false);
    }
  }, [selectedKbId]);

  useEffect(() => { void reloadKbs(); }, [reloadKbs]);
  useEffect(() => { void reloadFaqs(); }, [reloadFaqs]);

  const openKbCreate = () => {
    setKbModal({ open: true, editing: null });
    kbForm.resetFields();
    kbForm.setFieldsValue({ type: 'presales_faq' });
  };

  const openKbEdit = (kb: Kb) => {
    setKbModal({ open: true, editing: kb });
    kbForm.resetFields();
    kbForm.setFieldsValue({ name: kb.name, type: kb.type, description: kb.description ?? '' });
  };

  const submitKb = async () => {
    try {
      const values = await kbForm.validateFields();
      const payload = { ...values, description: values.description || undefined };
      if (kbModal.editing) {
        await knowledgeApi.updateKb(kbModal.editing.id, payload);
        antdMessage.success('KB updated');
      } else {
        await knowledgeApi.createKb(payload);
        antdMessage.success('KB created');
      }
      setKbModal({ open: false, editing: null });
      await reloadKbs();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      if (msg) antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg);
    }
  };

  const removeKb = async (kb: Kb) => {
    try {
      await knowledgeApi.deleteKb(kb.id);
      antdMessage.success(`Deleted KB "${kb.name}" — all its FAQs gone`);
      if (selectedKbId === kb.id) setSelectedKbId(null);
      await reloadKbs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const openFaqCreate = () => {
    if (!selectedKbId) {
      antdMessage.warning('Pick or create a KB first');
      return;
    }
    setFaqModal({ open: true, editing: null });
    faqForm.resetFields();
    faqForm.setFieldsValue({ enabled: true });
  };

  const openFaqEdit = (faq: Faq) => {
    setFaqModal({ open: true, editing: faq });
    faqForm.resetFields();
    faqForm.setFieldsValue({
      question: faq.question,
      answer: faq.answer,
      tags: faq.tags ?? [],
      enabled: faq.enabled,
    });
  };

  const submitFaq = async () => {
    try {
      const values = await faqForm.validateFields();
      if (faqModal.editing) {
        await knowledgeApi.updateFaq(faqModal.editing.id, values);
        antdMessage.success('FAQ updated');
      } else {
        if (!selectedKbId) return;
        await knowledgeApi.createFaq({ ...values, kbId: selectedKbId });
        antdMessage.success('FAQ created');
      }
      setFaqModal({ open: false, editing: null });
      await reloadFaqs();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      if (msg) antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg);
    }
  };

  const removeFaq = async (faq: Faq) => {
    try {
      await knowledgeApi.deleteFaq(faq.id);
      antdMessage.success('FAQ deleted');
      await reloadFaqs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const submitBulk = async () => {
    if (!selectedKbId) return;
    const items: Array<{ question: string; answer: string }> = [];
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      // accept tab- or pipe-separated
      const parts = line.split(/\t|\s{2,}|\|/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        items.push({ question: parts[0], answer: parts.slice(1).join(' ') });
      }
    }
    if (items.length === 0) {
      antdMessage.warning('No valid lines (use Q<TAB>A or Q | A per line)');
      return;
    }
    try {
      const res = await knowledgeApi.bulkImport(selectedKbId, items);
      antdMessage.success(`Imported ${res.data.imported} FAQ(s)`);
      setBulkText('');
      setBulkOpen(false);
      await reloadFaqs();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Import failed');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await knowledgeApi.search(searchQuery, selectedKbId ?? undefined);
      setSearchResults(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Search failed');
    }
  };

  const selectedKb = kbs.find(k => k.id === selectedKbId) ?? null;

  const faqColumns: ColumnsType<Faq> = [
    {
      title: 'Question',
      dataIndex: 'question',
      key: 'question',
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Answer',
      dataIndex: 'answer',
      key: 'answer',
      ellipsis: true,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 110,
      render: (s: FaqSource) => (
        <Tag color={s === 'ai_generated' ? 'purple' : s === 'imported' ? 'cyan' : 'default'}>
          {s.replace('_', ' ')}
        </Tag>
      ),
    },
    {
      title: 'Hits',
      dataIndex: 'hitCount',
      key: 'hitCount',
      width: 70,
      align: 'center',
    },
    {
      title: 'Enabled',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">on</Tag> : <Tag>off</Tag>),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      render: (_, faq) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openFaqEdit(faq)} />
          <Popconfirm
            title="Delete this FAQ?"
            onConfirm={() => removeFaq(faq)}
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ background: 'transparent', minHeight: 'calc(100vh - 200px)' }}>
      <Sider width={280} style={{ background: 'transparent', marginRight: 16 }}>
        <Card
          size="small"
          title={
            <Space>
              <BookOutlined />
              <span>Knowledge Bases</span>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>({kbs.length})</Text>
            </Space>
          }
          extra={
            <Space size={4}>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void reloadKbs()} loading={kbsLoading} />
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openKbCreate}>Add</Button>
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          {kbs.length === 0 ? (
            <div style={{ padding: 16 }}><Empty description="No KBs yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
          ) : (
            <Menu
              mode="inline"
              selectedKeys={selectedKbId ? [selectedKbId] : []}
              onClick={({ key }) => setSelectedKbId(key)}
              items={kbs.map(kb => ({
                key: kb.id,
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{kb.name}</span>
                    <Tag color={KB_TYPE_META[kb.type].color} style={{ fontSize: 10, padding: '0 4px' }}>
                      {KB_TYPE_META[kb.type].label}
                    </Tag>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </Sider>

      <Content>
        <Card
          title={
            selectedKb ? (
              <Space>
                <Text strong>{selectedKb.name}</Text>
                <Tag color={KB_TYPE_META[selectedKb.type].color}>{KB_TYPE_META[selectedKb.type].label}</Tag>
                {selectedKb.description ? <Text type="secondary" style={{ fontSize: 12 }}>{selectedKb.description}</Text> : null}
              </Space>
            ) : 'Pick a KB on the left'
          }
          extra={
            selectedKb && (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openKbEdit(selectedKb)}>Edit KB</Button>
                <Popconfirm
                  title={`Delete KB "${selectedKb.name}"?`}
                  description="All FAQs inside will be removed too."
                  onConfirm={() => removeKb(selectedKb)}
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>Delete KB</Button>
                </Popconfirm>
              </Space>
            )
          }
          style={{ marginBottom: 16 }}
        >
          <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
            <Input
              placeholder="Test search across FAQs (keyword match, score >= 0.6 → auto-reply)"
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
            />
            <Button type="primary" onClick={handleSearch}>Search</Button>
          </Space.Compact>
          {searchResults && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}:
              </Text>
              {searchResults.map((m, i) => (
                <Card
                  key={i}
                  size="small"
                  style={{ marginTop: 8, background: m.score >= 0.6 ? '#f6ffed' : '#fafafa' }}
                  title={
                    <Space>
                      <Text strong style={{ fontSize: 13 }}>{m.faq.question}</Text>
                      <Tag color={m.score >= 0.6 ? 'green' : 'default'}>score {m.score.toFixed(2)}</Tag>
                    </Space>
                  }
                >
                  <Text style={{ fontSize: 12 }}>{m.faq.answer}</Text>
                </Card>
              ))}
            </div>
          )}
        </Card>

        {selectedKb && (
          <Card
            title={
              <Space>
                <span>FAQs</span>
                <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>({faqs.length})</Text>
              </Space>
            }
            extra={
              <Space>
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void reloadFaqs()} loading={faqsLoading} />
                <Button size="small" onClick={() => setBulkOpen(true)}>Bulk Import</Button>
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openFaqCreate}>Add FAQ</Button>
              </Space>
            }
          >
            <Table
              columns={faqColumns}
              dataSource={faqs}
              rowKey="id"
              loading={faqsLoading}
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
              size="small"
              locale={{ emptyText: <Empty description="No FAQs yet — add some" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
          </Card>
        )}
      </Content>

      <Modal
        title={kbModal.editing ? `Edit KB: ${kbModal.editing.name}` : 'Create Knowledge Base'}
        open={kbModal.open}
        onCancel={() => setKbModal({ open: false, editing: null })}
        onOk={submitKb}
        okText={kbModal.editing ? 'Save' : 'Create'}
        destroyOnHidden
      >
        <Form form={kbForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, max: 128 }]}>
            <Input placeholder="e.g. April Pricing" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(KB_TYPE_META) as KbType[]).map(t => ({
                value: t,
                label: `${KB_TYPE_META[t].label} (${t})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="Description (optional)">
            <Input placeholder="What this KB covers" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={faqModal.editing ? 'Edit FAQ' : 'Add FAQ'}
        open={faqModal.open}
        onCancel={() => setFaqModal({ open: false, editing: null })}
        onOk={submitFaq}
        okText={faqModal.editing ? 'Save' : 'Create'}
        width={640}
        destroyOnHidden
      >
        <Form form={faqForm} layout="vertical">
          <Form.Item name="question" label="Question" rules={[{ required: true, max: 2000 }]}>
            <TextArea rows={2} placeholder="Customer's question (or topic phrase)" />
          </Form.Item>
          <Form.Item name="answer" label="Answer" rules={[{ required: true, max: 8000 }]}>
            <TextArea rows={5} placeholder="Bot's answer when this FAQ is matched" />
          </Form.Item>
          <Form.Item name="tags" label="Tags (optional)">
            <Select mode="tags" placeholder="extra search keywords" tokenSeparators={[',']} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Bulk import FAQs"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={submitBulk}
        okText="Import"
        width={640}
        destroyOnHidden
      >
        <Tooltip title="One FAQ per line. Q<TAB>A or Q | A.">
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            One per line. Use TAB / multiple spaces / | between question and answer.
          </Text>
        </Tooltip>
        <TextArea
          rows={12}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'How much does it cost?\tPlans start at $10/month\nWhat plans do you offer? | Basic, Pro, Enterprise'}
        />
      </Modal>
    </Layout>
  );
}
