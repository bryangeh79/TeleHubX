import { useCallback, useEffect, useState } from 'react';
import {
  Button, Drawer, Form, Input, Modal, Popconfirm, Select,
  Space, Switch, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PlusOutlined, StarOutlined,
  ThunderboltOutlined, PlusCircleOutlined, ImportOutlined,
} from '@ant-design/icons';
import { greetingTemplatesApi, tenantsApi } from '../../services/api';
import { useT } from '../../i18n';

const { Text } = Typography;
const { TextArea } = Input;

interface GreetingTemplate {
  id: string;
  text: string;
  category?: string;
  aiScore?: number;
  aiVariantEnabled?: boolean;
  variants?: Array<{ text: string }>;
  tenantId: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string; // 可选，没传时内部自己加载
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
  const [generating, setGenerating] = useState(false);
  const [score, setScore] = useState<number | undefined>();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [variants, setVariants] = useState<Array<{ text: string }>>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [autoCreatedId, setAutoCreatedId] = useState<string | null>(null);

  const currentId = template?.id ?? autoCreatedId;
  const isEdit = !!currentId;

  useEffect(() => {
    if (!open) return;
    if (template) {
      form.setFieldsValue({ text: template.text, category: template.category });
      setScore(template.aiScore);
      setAiEnabled(template.aiVariantEnabled ?? false);
      setVariants(template.variants ?? []);
    } else {
      form.resetFields();
      setScore(undefined);
      setAiEnabled(false);
      setVariants([]);
    }
    setAutoCreatedId(null);
  }, [open, template, form]);

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = {
        text: values.text,
        category: values.category,
        aiVariantEnabled: aiEnabled,
      };
      if (variants.length > 0) payload.variants = variants;
      if (currentId) {
        await greetingTemplatesApi.update(currentId, payload);
        antdMessage.success('已更新');
      } else {
        payload.tenantId = tenantId;
        await greetingTemplatesApi.create(payload);
        antdMessage.success('已保存');
      }
      onSave();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleScore = async () => {
    if (!currentId) { antdMessage.warning('请先保存后再用 AI 打分'); return; }
    setScoring(true);
    try {
      const res = await greetingTemplatesApi.score(currentId);
      setScore(res.data.aiScore);
      antdMessage.success(`AI 评分: ${res.data.aiScore} / 10`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 打分失败');
    } finally {
      setScoring(false);
    }
  };

  const handleGenerateVariants = async () => {
    let targetId = currentId;
    if (!targetId) {
      let values: any;
      try { values = await form.validateFields(); } catch { setShowConfirm(false); return; }
      setSaving(true);
      try {
        const res = await greetingTemplatesApi.create({
          tenantId, text: values.text, category: values.category, aiVariantEnabled: true,
        });
        targetId = res.data.id;
        setAutoCreatedId(targetId);
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? '保存失败');
        setSaving(false);
        setShowConfirm(false);
        return;
      } finally {
        setSaving(false);
      }
    }
    setGenerating(true);
    try {
      const result = await greetingTemplatesApi.generateVariants(targetId!);
      const vars = result.data.variants ?? [];
      setVariants(vars);
      antdMessage.success(`✓ 已生成 ${vars.length} 条变体，满意后点保存`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败');
    } finally {
      setGenerating(false);
      setShowConfirm(false);
    }
  };

  const scoreColor = score
    ? score >= 8 ? '#52c41a' : score >= 5 ? '#faad14' : '#ff4d4f'
    : '#d9d9d9';

  return (
    <Modal
      open={open}
      title={template ? '编辑开场白' : '新建开场白'}
      onCancel={onClose}
      width={520}
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
          <TextArea rows={2} placeholder="例: 你好，打扰您一下 👋" maxLength={200} showCount />
        </Form.Item>

        <Form.Item name="category" label="分类 (可选)">
          <Select placeholder="选择分类" allowClear
            options={CATEGORIES.map(c => ({ value: c, label: c }))} />
        </Form.Item>

        {/* AI 评分 */}
        <div style={{
          border: '1px solid #e8e8e8', borderRadius: 8, padding: 10, marginBottom: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>AI 质量评分</Text>
            <div><Text type="secondary" style={{ fontSize: 11 }}>1-10 分，用平台 AI 评估</Text></div>
          </div>
          <Space>
            {score !== undefined && score !== null && (
              <Tag color={scoreColor} style={{ fontSize: 14, padding: '2px 8px' }}>{score} / 10</Tag>
            )}
            <Button icon={<StarOutlined />} loading={scoring} onClick={handleScore} disabled={!isEdit} size="small">
              AI 打分
            </Button>
          </Space>
        </div>

        {/* AI 变体池 */}
        <div style={{
          border: '1px solid #e8e8e8', borderRadius: 8, padding: 12,
          background: aiEnabled ? '#f6ffed' : '#fafafa',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiEnabled ? 12 : 0 }}>
            <Space>
              <ThunderboltOutlined style={{ color: '#52c41a' }} />
              <Text strong>AI 变体池</Text>
              <Tag color="green" style={{ fontSize: 11 }}>多样化·防封号</Tag>
            </Space>
            <Switch checked={aiEnabled} onChange={v => setAiEnabled(v)}
              style={{ background: aiEnabled ? '#52c41a' : undefined }} />
          </div>
          {aiEnabled && (
            <>
              <Space style={{ marginBottom: 8 }}>
                <Button type="primary" icon={<ThunderboltOutlined />} loading={generating}
                  onClick={() => setShowConfirm(true)}
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                  AI 生成 8 条变体
                </Button>
                <Button icon={<PlusCircleOutlined />} onClick={() => setVariants(v => [...v, { text: '' }])}>
                  手动增加
                </Button>
              </Space>
              {variants.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '12px 0', color: '#999', fontSize: 12 }}>
                  还没有变体 · 点上方按钮生成
                </div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {variants.map((v, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <Input
                        value={v.text}
                        onChange={e => setVariants(arr => arr.map((x, idx) => idx === i ? { text: e.target.value } : x))}
                        size="small"
                        style={{ flex: 1, fontSize: 12 }}
                      />
                      <Button size="small" danger icon={<DeleteOutlined />}
                        onClick={() => setVariants(arr => arr.filter((_, idx) => idx !== i))} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Form>

      <Modal
        open={showConfirm}
        title={null}
        onCancel={() => setShowConfirm(false)}
        footer={null}
        width={360}
        centered
      >
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
          <Text strong>现在生成 8 条 AI 变体？</Text>
          <div><Text type="secondary" style={{ fontSize: 12 }}>会先自动保存，然后用 AI 生成 · 约 5-10 秒</Text></div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button onClick={() => setShowConfirm(false)}>先不生成</Button>
          <Button type="primary" loading={generating} onClick={handleGenerateVariants}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            开始生成
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}

// ── Main Drawer ─────────────────────────────────────────────────────────

export default function GreetingDrawer({ open, onClose, tenantId: tenantIdProp }: Props) {
  const t = useT();
  const [tenantId, setTenantId] = useState<string>(tenantIdProp ?? '');
  const [templates, setTemplates] = useState<GreetingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GreetingTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);

  // 兜底：传进来的 tenantId 是空的话，自己拉一次
  useEffect(() => {
    if (tenantIdProp) { setTenantId(tenantIdProp); return; }
    if (!open) return;
    tenantsApi.getDefault()
      .then(r => { if (r.data?.id) setTenantId(r.data.id); })
      .catch(() => {});
  }, [open, tenantIdProp]);

  const load = useCallback(async () => {
    if (!tenantId) return;
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

  useEffect(() => { if (open && tenantId) void load(); }, [open, tenantId, load]);

  const handleDelete = async (t: GreetingTemplate) => {
    try {
      await greetingTemplatesApi.delete(t.id);
      antdMessage.success('已删除');
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const handleSeedDefaults = async () => {
    if (!tenantId) { antdMessage.warning('租户 ID 未加载'); return; }
    setSeeding(true);
    try {
      const res = await greetingTemplatesApi.seedDefaults(tenantId);
      const { created, skipped } = res.data;
      antdMessage.success(`已导入 ${created} 条样本${skipped ? `，跳过 ${skipped} 条已存在` : ''}`);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '导入失败');
    } finally {
      setSeeding(false);
    }
  };

  const scoreColor = (s?: number) => !s ? '#d9d9d9'
    : s >= 8 ? '#52c41a' : s >= 5 ? '#faad14' : '#ff4d4f';

  // 按 category 分组
  const grouped: Record<string, GreetingTemplate[]> = {};
  for (const t of templates) {
    const cat = t.category || '未分类';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }
  const sortedCats = ['礼貌', '好奇', '优惠', '热情', '专业', '幽默', '未分类']
    .filter(c => grouped[c]?.length);

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('drawer.greeting')} ({templates.length})</span>
            <Space>
              <Button icon={<ImportOutlined />} onClick={handleSeedDefaults} loading={seeding}>
                {t('common.import')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />}
                onClick={() => { setEditing(null); setModalOpen(true); }}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                {t('common.create')}
              </Button>
            </Space>
          </div>
        }
        width={520}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div>还没有开场白</div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              建议先「一键导入示例」获得 18 条不同语气的样本
            </Text>
            <Space style={{ marginTop: 12 }}>
              <Button icon={<ImportOutlined />} onClick={handleSeedDefaults} loading={seeding}>
                一键导入示例
              </Button>
              <Button type="primary" onClick={() => { setEditing(null); setModalOpen(true); }}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                自己写一条
              </Button>
            </Space>
          </div>
        ) : (
          <div>
            {sortedCats.map(cat => (
              <div key={cat} style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 13, color: '#52c41a', display: 'block', marginBottom: 6 }}>
                  {cat} <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>({grouped[cat].length})</Text>
                </Text>
                {grouped[cat].map(t => (
                  <div key={t.id} style={{
                    border: '1px solid #e8e8e8', borderRadius: 8, padding: 10,
                    marginBottom: 6, background: '#fff',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: 8 }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                          {t.aiScore !== undefined && t.aiScore !== null && (
                            <Tag color={scoreColor(t.aiScore)} icon={<StarOutlined />} style={{ fontSize: 10 }}>
                              AI · {t.aiScore}
                            </Tag>
                          )}
                          {(t.variants?.length ?? 0) > 0 && (
                            <Tag color="purple" icon={<ThunderboltOutlined />} style={{ fontSize: 10 }}>
                              {t.variants!.length} 变体
                            </Tag>
                          )}
                        </div>
                        <Text style={{ fontSize: 13 }}>{t.text}</Text>
                      </div>
                      <Space size={2}>
                        <Button size="small" type="link" icon={<EditOutlined />}
                          onClick={() => { setEditing(t); setModalOpen(true); }} />
                        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(t)}
                          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                          <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    </div>
                  </div>
                ))}
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
