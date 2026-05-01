import { useCallback, useEffect, useState } from 'react';
import {
  Button, Drawer, Form, Input, Modal, Popconfirm,
  Select, Space, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PlusOutlined, StarOutlined,
} from '@ant-design/icons';
import { greetingTemplatesApi } from '../../services/api';

const { Text } = Typography;
const { TextArea } = Input;

interface GreetingTemplate {
  id: string;
  text: string;
  category?: string;
  aiScore?: number;
  tenantId: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
}

const CATEGORIES = ['礼貌', '好奇', '优惠', '热情', '专业', '幽默'];

// ── Edit Modal ──────────────────────────────────────────────────────────

function GreetingModal({
  open, template, tenantId, onSave, onClose,
}: {
  open: boolean;
  template: GreetingTemplate | null;
  tenantId: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [score, setScore] = useState<number | undefined>();
  const isEdit = !!template;

  useEffect(() => {
    if (!open) return;
    if (template) {
      form.setFieldsValue({ text: template.text, category: template.category });
      setScore(template.aiScore);
    } else {
      form.resetFields();
      setScore(undefined);
    }
  }, [open, template, form]);

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = { tenantId, text: values.text, category: values.category };
      if (isEdit && template) {
        await greetingTemplatesApi.update(template.id, payload);
      } else {
        await greetingTemplatesApi.create(payload);
      }
      antdMessage.success(isEdit ? '已更新' : '已保存');
      onSave();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleScore = async () => {
    if (!template?.id) {
      antdMessage.warning('请先保存后再用 AI 打分');
      return;
    }
    setScoring(true);
    try {
      const res = await greetingTemplatesApi.score(template.id);
      setScore(res.data.aiScore);
      antdMessage.success(`AI 评分: ${res.data.aiScore} / 10`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 打分失败');
    } finally {
      setScoring(false);
    }
  };

  const scoreColor = score
    ? score >= 8 ? '#52c41a' : score >= 5 ? '#faad14' : '#ff4d4f'
    : '#d9d9d9';

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑开场白' : '新建开场白'}
      onCancel={onClose}
      width={480}
      footer={
        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="text" label={<span style={{ color: '#ff4d4f' }}>* 开场白文案</span>}
          rules={[{ required: true, message: '必填' }]}>
          <TextArea
            rows={3}
            placeholder="例: 你好，打扰您一下 👋"
            maxLength={200}
            showCount
          />
        </Form.Item>

        <Form.Item name="category" label="分类 (可选)">
          <Select
            placeholder="选择分类"
            allowClear
            options={CATEGORIES.map(c => ({ value: c, label: c }))}
          />
        </Form.Item>

        <div style={{
          border: '1px solid #e8e8e8', borderRadius: 8, padding: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>AI 质量评分</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                用平台 AI 评估这条开场白的转化潜力 (1-10 分)
              </Text>
            </div>
          </div>
          <Space>
            {score !== undefined && (
              <Tag color={scoreColor} style={{ fontSize: 14, padding: '2px 8px' }}>
                {score} / 10
              </Tag>
            )}
            <Button
              icon={<StarOutlined />}
              loading={scoring}
              onClick={handleScore}
              disabled={!isEdit}
              size="small"
            >
              AI 打分
            </Button>
          </Space>
        </div>
      </Form>
    </Modal>
  );
}

// ── Main Drawer ─────────────────────────────────────────────────────────

export default function GreetingDrawer({ open, onClose, tenantId }: Props) {
  const [templates, setTemplates] = useState<GreetingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GreetingTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await greetingTemplatesApi.list(tenantId);
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const handleDelete = async (t: GreetingTemplate) => {
    try {
      await greetingTemplatesApi.delete(t.id);
      antdMessage.success('已删除');
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const scoreColor = (s?: number) => !s ? '#d9d9d9'
    : s >= 8 ? '#52c41a' : s >= 5 ? '#faad14' : '#ff4d4f';

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>开场白库</span>
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setEditing(null); setModalOpen(true); }}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}>
              新建开场白
            </Button>
          </div>
        }
        width={480}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div>还没有开场白</div>
            <Button type="primary" onClick={() => { setEditing(null); setModalOpen(true); }}
              style={{ marginTop: 12, background: '#52c41a', borderColor: '#52c41a' }}>
              新建第一条
            </Button>
          </div>
        ) : (
          <div>
            {templates.map(t => (
              <div
                key={t.id}
                style={{
                  border: '1px solid #e8e8e8', borderRadius: 8, padding: 12,
                  marginBottom: 8, background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, marginRight: 8 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                      {t.category && <Tag style={{ fontSize: 11 }}>{t.category}</Tag>}
                      {t.aiScore !== undefined && t.aiScore !== null && (
                        <Tag color={scoreColor(t.aiScore)} icon={<StarOutlined />} style={{ fontSize: 11 }}>
                          AI · {t.aiScore}
                        </Tag>
                      )}
                    </div>
                    <Text style={{ fontSize: 13 }}>{t.text}</Text>
                  </div>
                  <Space size={4}>
                    <Button size="small" type="link" icon={<EditOutlined />}
                      onClick={() => { setEditing(t); setModalOpen(true); }}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除？"
                      onConfirm={() => handleDelete(t)}
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <GreetingModal
        open={modalOpen}
        template={editing}
        tenantId={tenantId}
        onSave={() => { setModalOpen(false); void load(); }}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
