import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge, Button, Drawer, Form, Input, Modal,
  Popconfirm, Space, Switch, Tag, Typography, message as antdMessage, Progress,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PlusOutlined,
  ThunderboltOutlined, PlusCircleOutlined, UploadOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { adTemplatesApi, assetsApi, tenantsApi } from '../../services/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface AdTemplate {
  id: string;
  name: string;
  content: string;
  description?: string;
  hasMedia: boolean;
  mediaAssetId?: string;
  aiVariantEnabled: boolean;
  isActive: boolean;
  variants?: Array<{ text: string }>;
  tags?: string[];
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
}

// ── Edit Modal ──────────────────────────────────────────────────────────

function AdTemplateModal({
  open, template, tenantId, onSave, onClose,
}: {
  open: boolean;
  template: AdTemplate | null;
  tenantId: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [variants, setVariants] = useState<Array<{ text: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mediaAssetId, setMediaAssetId] = useState<string>('');
  const [mediaFileName, setMediaFileName] = useState<string>('');
  const [uploadPct, setUploadPct] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  // 用于追踪 auto-create 出的 id，避免重复保存
  const [autoCreatedId, setAutoCreatedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 真实 id：编辑时来自 template.id，新建时可能来自 auto-create
  const currentId = template?.id ?? autoCreatedId;
  const isEdit = !!currentId;

  useEffect(() => {
    if (!open) return;
    if (template) {
      form.setFieldsValue({ name: template.name, content: template.content });
      setAiEnabled(template.aiVariantEnabled);
      setVariants(template.variants ?? []);
      setMediaAssetId(template.mediaAssetId ?? '');
      setMediaFileName(template.mediaAssetId ? '已附加素材' : '');
    } else {
      form.resetFields();
      setAiEnabled(false);
      setVariants([]);
      setMediaAssetId('');
      setMediaFileName('');
    }
    setAutoCreatedId(null); // 每次打开重置
    setUploadPct(0);
  }, [open, template, form]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const mime = file.type;
      const category = mime.startsWith('video') ? 'video'
        : mime.startsWith('audio') ? 'voice'
        : 'photo'; // default image/document → photo
      const res = await assetsApi.upload(file, { category, description: file.name });
      const asset = res.data;
      setMediaAssetId(asset.id ?? '');
      setMediaFileName(file.name);
      antdMessage.success(`已上传: ${file.name}`);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '上传失败');
    } finally {
      setUploading(false);
      setUploadPct(100);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload: any = {
        name: values.name,
        content: values.content,
        aiVariantEnabled: aiEnabled,
        hasMedia: !!mediaAssetId,
        mediaAssetId: mediaAssetId || undefined,
      };
      // 把当前编辑的 variants 也保存（用户可能手动改过）
      if (variants.length > 0) {
        payload.variants = variants;
      }
      if (currentId) {
        await adTemplatesApi.update(currentId, payload);
        antdMessage.success('已更新');
      } else {
        payload.tenantId = tenantId;
        await adTemplatesApi.create(payload);
        antdMessage.success('已保存');
      }
      onSave();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateVariants = async () => {
    let targetId = currentId;

    // 如果还没保存过，先 auto-create 一次（只创建一次）
    if (!targetId) {
      let values: any;
      try { values = await form.validateFields(); } catch { setShowConfirm(false); return; }
      setSaving(true);
      try {
        const res = await adTemplatesApi.create({
          tenantId,
          name: values.name,
          content: values.content,
          aiVariantEnabled: true,
          hasMedia: !!mediaAssetId,
          mediaAssetId: mediaAssetId || undefined,
        });
        targetId = res.data.id;
        setAutoCreatedId(targetId); // 关键：记录已创建的 id，handleSave 走 update
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? '保存广告失败');
        setSaving(false);
        setShowConfirm(false);
        return;
      } finally {
        setSaving(false);
      }
    }

    // 生成变体
    setGenerating(true);
    try {
      const result = await adTemplatesApi.generateVariants(targetId!);
      const vars = result.data.variants ?? [];
      setVariants(vars);
      antdMessage.success(`✓ 已生成 ${vars.length} 条 AI 变体，查看下方列表，满意后点保存`);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(msg ?? 'AI 生成失败，请检查平台 AI Key 配置');
    } finally {
      setGenerating(false);
      setShowConfirm(false);
    }
  };

  const addManualVariant = () => {
    setVariants(v => [...v, { text: '' }]);
  };

  const updateVariant = (i: number, text: string) => {
    setVariants(v => v.map((x, idx) => idx === i ? { text } : x));
  };

  const removeVariant = (i: number) => {
    setVariants(v => v.filter((_, idx) => idx !== i));
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑广告' : '新建广告'}
      onCancel={onClose}
      width={580}
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
        <Form.Item name="name" label={<span style={{ color: '#ff4d4f' }}>* 名称</span>}
          rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="例: 618 促销广告" maxLength={50} showCount />
        </Form.Item>

        <Form.Item name="content" label={<span style={{ color: '#ff4d4f' }}>* 文案内容</span>}
          rules={[{ required: true, message: '必填' }]}>
          <TextArea
            rows={5}
            placeholder="写你要发给客户的广告内容…"
            maxLength={4096}
            showCount
          />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: -8, marginBottom: 12 }}>
          原始文案 · 发送时会根据下方「AI 变体池」设置决定实际发哪条
        </Text>

        <Form.Item label="附加素材 (可选)">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Space wrap>
            <Button
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              上传图片 / 视频 / 语音
            </Button>
            {mediaFileName && (
              <Space size={4}>
                <Tag color="blue" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {mediaFileName}
                </Tag>
                <CloseCircleOutlined
                  style={{ color: '#ff4d4f', cursor: 'pointer' }}
                  onClick={() => { setMediaAssetId(''); setMediaFileName(''); }}
                />
              </Space>
            )}
          </Space>
          {uploading && (
            <Progress percent={uploadPct} size="small" style={{ marginTop: 4, maxWidth: 300 }} />
          )}
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>支持 jpg/png/mp4/mp3/ogg · 最大 50MB</Text>
          </div>
          {!mediaFileName && (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>或直接填素材 ID：</Text>
              <Input
                placeholder="素材 UUID"
                value={mediaAssetId}
                onChange={e => setMediaAssetId(e.target.value)}
                style={{ width: 260, marginLeft: 4 }}
                size="small"
              />
            </div>
          )}
        </Form.Item>

        <div style={{
          border: '1px solid #e8e8e8', borderRadius: 8, padding: 12,
          background: aiEnabled ? '#f6ffed' : '#fafafa',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: aiEnabled ? 12 : 0 }}>
            <Space>
              <ThunderboltOutlined style={{ color: '#52c41a' }} />
              <Text strong>AI 变体池</Text>
              <Tag color="green" style={{ fontSize: 11 }}>推荐·防封号</Tag>
            </Space>
            <Switch
              checked={aiEnabled}
              onChange={v => setAiEnabled(v)}
              style={{ background: aiEnabled ? '#52c41a' : undefined }}
            />
          </div>

          {aiEnabled && (
            <>
              <Space style={{ marginBottom: 8 }}>
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={generating}
                  onClick={() => setShowConfirm(true)}
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                >
                  AI 生成 10 条变体
                </Button>
                <Button icon={<PlusCircleOutlined />} onClick={addManualVariant}>手动增加</Button>
              </Space>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                点上方按钮会自动保存广告并生成变体 (需先填名称和文案)
              </Text>

              {variants.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: '#999' }}>
                  <div style={{ fontSize: 24 }}>✏️</div>
                  <div style={{ fontSize: 12 }}>还没有变体 · 点上方按钮生成</div>
                </div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {variants.map((v, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <TextArea
                        value={v.text}
                        onChange={e => updateVariant(i, e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        style={{ flex: 1, fontSize: 12 }}
                      />
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeVariant(i)}
                        style={{ alignSelf: 'flex-start', marginTop: 4 }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Form>

      {/* AI generate confirm */}
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
          <Title level={5} style={{ margin: 0 }}>现在生成 10 条 AI 变体？</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            会先自动保存这条广告，然后用 AI 生成 10 条变体 · 约 5-15 秒
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button onClick={() => setShowConfirm(false)}>先不生成</Button>
          <Button
            type="primary"
            loading={generating}
            onClick={handleGenerateVariants}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            开始生成
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}

// ── Main Drawer ─────────────────────────────────────────────────────────

export default function AdTemplateDrawer({ open, onClose, tenantId }: Props) {
  const [templates, setTemplates] = useState<AdTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adTemplatesApi.list(tenantId);
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const handleDelete = async (t: AdTemplate) => {
    try {
      await adTemplatesApi.delete(t.id);
      antdMessage.success(`已删除「${t.name}」`);
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (t: AdTemplate) => { setEditing(t); setModalOpen(true); };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>广告文案库</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}>
              新建广告
            </Button>
          </div>
        }
        closable={true}
        width={520}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
            <div>还没有广告文案</div>
            <Button type="primary" onClick={openNew} style={{ marginTop: 12, background: '#52c41a', borderColor: '#52c41a' }}>
              新建第一条
            </Button>
          </div>
        ) : (
          <div>
            {templates.map((t, idx) => (
              <div
                key={t.id}
                style={{
                  border: '1px solid #e8e8e8', borderRadius: 8, padding: 14,
                  marginBottom: 10, background: '#fff',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <Space size={4} wrap>
                    <Tag color="default" style={{ fontSize: 11 }}>#{templates.length - idx}</Tag>
                    <Text strong style={{ fontSize: 14 }}>{t.name}</Text>
                    <Badge
                      color={t.isActive ? '#52c41a' : '#d9d9d9'}
                      text={<Text style={{ fontSize: 11, color: t.isActive ? '#52c41a' : '#999' }}>
                        {t.isActive ? '启用' : '停用'}
                      </Text>}
                    />
                    {t.hasMedia && <Tag color="blue" style={{ fontSize: 11 }}>含素材</Tag>}
                    {t.aiVariantEnabled && (t.variants?.length ?? 0) > 0 && (
                      <Tag color="purple" icon={<ThunderboltOutlined />} style={{ fontSize: 11 }}>
                        AI · {t.variants!.length} 变体
                      </Tag>
                    )}
                  </Space>
                  <Space size={4}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(t)}>编辑</Button>
                    <Popconfirm
                      title={`删除「${t.name}」?`}
                      onConfirm={() => handleDelete(t)}
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                </div>

                {/* Content preview */}
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {t.content.slice(0, 120)}{t.content.length > 120 ? '…' : ''}
                </Text>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    最近修改: {dayjs(t.updatedAt).format('YYYY/M/D')}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <AdTemplateModal
        open={modalOpen}
        template={editing}
        tenantId={tenantId}
        onSave={() => { setModalOpen(false); void load(); }}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
