import { useEffect, useState } from 'react';
import {
  Alert, Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Space,
  Switch, Table, Tag, message as antdMessage,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { knowledgeApi } from '../../services/api';
import { useT } from '../../i18n';

const { TextArea } = Input;

interface Faq {
  id: string;
  kbId: string;
  question: string;
  answer: string;
  tags: string[];
  enabled: boolean;
  source: string;
  hitCount?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

export default function GeneralFaqDrawer({ open, onClose, tenantId }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [kbId, setKbId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Faq | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ question: string; answer: string; tagsCsv?: string }>();

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await knowledgeApi.listGeneralFaqs(tenantId);
      setKbId(res.data?.kb?.id ?? null);
      setFaqs(res.data?.faqs ?? []);
    } catch {
      antdMessage.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) void load(); }, [open, tenantId]);

  const ensureKb = async (): Promise<string | null> => {
    if (kbId) return kbId;
    if (!tenantId) return null;
    const res = await knowledgeApi.ensureCompanyKb(tenantId);
    const id = res.data?.id ?? null;
    setKbId(id);
    return id;
  };

  const handleGenerate = async () => {
    if (!tenantId) return;
    Modal.confirm({
      title: 'AI 一键生成 12 条闲聊 FAQ？',
      content: '将基于「客户与 Bot 闲聊场景」生成常见问答（如「你是真人吗」「工作时间外能找到人吗」），自动入库。已有的 FAQ 不会被覆盖。',
      okText: '开始生成',
      cancelText: '取消',
      onOk: async () => {
        setGenerating(true);
        try {
          const res = await knowledgeApi.generateGeneralChatFaqs(tenantId, 12);
          antdMessage.success(`已生成 ${res.data?.generated ?? 0} 条闲聊 FAQ`);
          await load();
        } catch (err: any) {
          antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请检查平台 AI Key');
        } finally {
          setGenerating(false);
        }
      },
    });
  };

  const startCreate = () => {
    form.resetFields();
    setEditing(null);
    setCreating(true);
  };

  const startEdit = (f: Faq) => {
    form.setFieldsValue({
      question: f.question,
      answer: f.answer,
      tagsCsv: (f.tags ?? []).join(', '),
    });
    setEditing(f);
    setCreating(true);
  };

  const handleSubmit = async () => {
    let v: { question: string; answer: string; tagsCsv?: string };
    try { v = await form.validateFields(); } catch { return; }
    const tags = (v.tagsCsv ?? '').split(',').map(s => s.trim()).filter(Boolean);
    try {
      if (editing) {
        await knowledgeApi.updateFaq(editing.id, {
          question: v.question.trim(),
          answer: v.answer.trim(),
          tags,
        });
        antdMessage.success('已更新');
      } else {
        const id = await ensureKb();
        if (!id) { antdMessage.error('无法创建公司 KB'); return; }
        await knowledgeApi.createFaq({
          kbId: id,
          question: v.question.trim(),
          answer: v.answer.trim(),
          tags: tags.length ? tags : ['chitchat'],
          enabled: true,
        });
        antdMessage.success('已新增');
      }
      setCreating(false);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    }
  };

  const handleToggle = async (f: Faq, enabled: boolean) => {
    try {
      await knowledgeApi.updateFaq(f.id, { enabled });
      setFaqs(prev => prev.map(x => x.id === f.id ? { ...x, enabled } : x));
    } catch {
      antdMessage.error('切换失败');
    }
  };

  const handleDelete = async (f: Faq) => {
    try {
      await knowledgeApi.deleteFaq(f.id);
      antdMessage.success('已删除');
      setFaqs(prev => prev.filter(x => x.id !== f.id));
    } catch {
      antdMessage.error('删除失败');
    }
  };

  return (
    <Drawer
      title={<Space>📋 {t('drawer.generalFaq')}</Space>}
      open={open}
      onClose={onClose}
      width={840}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="通用 FAQ 是什么？"
        description={
          <span>
            客户和 Bot 闲聊场景的常见问答，例如「你是真人吗」「你能干嘛」「你们 24 小时在吗」「早上好」等。
            这些 FAQ 挂在「公司通用资料」KB 下，当客户问的问题不在产品 FAQ 中时优先匹配。
            建议覆盖：身份疑问 / 能力试探 / 工作时间 / 礼貌寒暄 / 表达情绪 / 离开告别。
          </span>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Tag color="default">共 {faqs.length} 条</Tag>
          <Tag color={faqs.filter(f => f.enabled).length > 0 ? 'green' : 'default'}>
            启用 {faqs.filter(f => f.enabled).length} 条
          </Tag>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void load()} loading={loading}>{t('common.refresh')}</Button>
          <Button icon={<PlusOutlined />} size="small" onClick={startCreate} disabled={!tenantId}>{t('modal.faq.add')}</Button>
          <Button
            icon={<ThunderboltOutlined />}
            type="primary"
            size="small"
            onClick={handleGenerate}
            loading={generating}
            disabled={!tenantId}
          >
            ✨ AI 一键生成 12 条
          </Button>
        </Space>
      </div>

      {faqs.length === 0 && !loading ? (
        <Empty description="还没有通用 FAQ。点击右上角「AI 一键生成」快速创建一组示例。" style={{ padding: 60 }} />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={faqs}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            {
              title: t('form.question'),
              dataIndex: 'question',
              width: 240,
              render: (q: string) => <span style={{ fontWeight: 500 }}>{q}</span>,
            },
            {
              title: t('form.answer'),
              dataIndex: 'answer',
              ellipsis: true,
              render: (a: string) => <span style={{ color: '#666', fontSize: 12 }}>{a}</span>,
            },
            {
              title: t('common.enable'),
              dataIndex: 'enabled',
              width: 70,
              align: 'center',
              render: (v: boolean, r: Faq) => (
                <Switch size="small" checked={v} onChange={c => handleToggle(r, c)} />
              ),
            },
            {
              title: t('common.actions'),
              width: 110,
              render: (_, r: Faq) => (
                <Space size={4}>
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => startEdit(r)} />
                  <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(r)} okText={t('common.delete')} cancelText={t('common.cancel')}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      <Modal
        title={editing ? t('modal.faq.edit') : t('modal.faq.add')}
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={handleSubmit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="question"
            label={t('form.question')}
            rules={[{ required: true, message: t('form.required') }, { max: 200, message: t('form.tooLong') }]}
          >
            <Input placeholder={t('form.placeholder.required')} />
          </Form.Item>
          <Form.Item
            name="answer"
            label={t('form.answer')}
            rules={[{ required: true, message: t('form.required') }, { max: 500, message: t('form.tooLong') }]}
          >
            <TextArea rows={4} placeholder={t('form.placeholder.required')} />
          </Form.Item>
          <Form.Item
            name="tagsCsv"
            label={t('form.tagsOptional')}
          >
            <Input placeholder={t('form.placeholder.optional')} />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
