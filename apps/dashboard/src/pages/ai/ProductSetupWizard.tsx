import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Drawer, Empty, Form, Input,
  List, Popconfirm, Row, Select, Space, Spin, Steps, Tag, Tabs,
  Tooltip, Typography, Upload, message as antdMessage,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined,
  PlusOutlined, RobotOutlined, UploadOutlined,
} from '@ant-design/icons';
import { knowledgeApi } from '../../services/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

interface ProductFaq { question: string; answer: string; tags: string[] }

interface ProductForm {
  productName: string;
  price?: string;
  category?: string;
}

const GOAL_OPTIONS = [
  { label: '🎯 预约 Demo（30 分钟线上演示）', value: '预约 Demo（30 分钟线上演示）' },
  { label: '📋 收集线索（姓名/联系方式/需求）', value: '收集线索（姓名/联系方式/需求）' },
  { label: '💬 了解更多（引导加 WhatsApp/Telegram）', value: '了解更多（引导加 WhatsApp/Telegram）' },
  { label: '📞 联系销售员', value: '联系销售员' },
  { label: '🆓 申请免费试用', value: '申请免费试用' },
];

const CATEGORY_OPTIONS = [
  'SaaS 软件', '硬件/设备', '咨询服务', '培训课程',
  '金融产品', '健康/美容', '食品/餐饮', '房产', '其他',
];

function ProductCard({
  kb, onEdit, onDelete,
}: {
  kb: any;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text strong>{kb.name.replace(' - 产品资料', '')}</Text>
          {kb.description && (() => {
            try { return <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{JSON.parse(kb.description)?.price ?? ''}</Text>; } catch { return null; }
          })()}
          {kb.goalPrompt && (
            <Tag color="blue" style={{ fontSize: 11, marginTop: 4 }}>目标：{kb.goalPrompt.slice(0, 20)}...</Tag>
          )}
        </div>
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={onEdit}>编辑</Button>
          <Popconfirm title="确认删除此产品？" onConfirm={onDelete} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}

export default function ProductSetupWizard({ open, onClose, tenantId }: Props) {
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);

  // Wizard state
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<ProductForm>();
  const [inputMode, setInputMode] = useState<'text' | 'upload'>('text');
  const [rawText, setRawText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Generated result
  const [overview, setOverview] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [faq, setFaq] = useState<ProductFaq[]>([]);
  const [goal, setGoal] = useState(GOAL_OPTIONS[0].value);
  const [editingFaqIdx, setEditingFaqIdx] = useState<number | null>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await knowledgeApi.listKbs({ type: 'product' });
      setProducts((res.data ?? []).filter((k: any) => !tenantId || k.tenantId === tenantId));
    } catch {}
    finally { setLoadingProducts(false); }
  }, [tenantId]);

  useEffect(() => { if (open) void loadProducts(); }, [open, loadProducts]);

  const resetWizard = () => {
    setStep(0);
    setRawText('');
    setOverview('');
    setFeatures([]);
    setFaq([]);
    setGoal(GOAL_OPTIONS[0].value);
    setEditingKbId(null);
    form.resetFields();
  };

  const openNewProduct = () => { resetWizard(); setShowEditor(true); };

  const openEditProduct = async (kb: any) => {
    resetWizard();
    setEditingKbId(kb.id);
    try {
      const saved = JSON.parse(kb.description ?? '{}');
      form.setFieldsValue({ productName: saved.productName ?? kb.name.replace(' - 产品资料', ''), price: saved.price, category: saved.category });
      setOverview(saved.overview ?? '');
      setFeatures(saved.features ?? []);
      setGoal(kb.goalPrompt ?? GOAL_OPTIONS[0].value);
      // Load FAQs from backend
      const faqRes = await knowledgeApi.listFaqs({ kbId: kb.id });
      setFaq((faqRes.data ?? []).map((f: any) => ({ question: f.question, answer: f.answer, tags: f.tags ?? [] })));
      setStep(2); // Jump to review step
    } catch {}
    setShowEditor(true);
  };

  const handleDeleteProduct = async (kbId: string) => {
    try {
      await knowledgeApi.deleteKb(kbId);
      antdMessage.success('产品已删除');
      void loadProducts();
    } catch { antdMessage.error('删除失败'); }
  };

  const handleGenerate = async () => {
    let values: ProductForm;
    try { values = await form.validateFields(); } catch { return; }
    if (!rawText.trim()) { antdMessage.warning('请先填写产品描述或上传介绍书'); return; }

    setGenerating(true);
    try {
      const res = await knowledgeApi.generateProductProfile({
        productName: values.productName,
        price: values.price,
        rawText,
      });
      setOverview(res.data.overview ?? '');
      setFeatures(res.data.features ?? []);
      setFaq(res.data.faq ?? []);
      setGoal(res.data.suggestedGoal ?? GOAL_OPTIONS[0].value);
      setStep(2);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请重试');
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    let values: ProductForm;
    try { values = await form.validateFields(); } catch { return; }

    setSaving(true);
    try {
      const dto = {
        name: `${values.productName} - 产品资料`,
        type: 'product',
        description: JSON.stringify({ productName: values.productName, price: values.price, category: values.category, overview, features }),
        goalPrompt: goal,
        tenantId,
        enabled: true,
      };

      let kbId: string;
      if (editingKbId) {
        await knowledgeApi.updateKb(editingKbId, dto);
        kbId = editingKbId;
        // Delete old FAQs then re-import
        const oldFaqs = await knowledgeApi.listFaqs({ kbId });
        for (const f of (oldFaqs.data ?? [])) await knowledgeApi.deleteFaq(f.id);
      } else {
        const res = await knowledgeApi.createKb(dto);
        kbId = res.data.id;
      }

      // Bulk import FAQs
      if (faq.length > 0) {
        await knowledgeApi.bulkImport(kbId, faq.map(f => ({ question: f.question, answer: f.answer, tags: f.tags })));
      }

      antdMessage.success(`产品已保存，生成 ${faq.length} 条 FAQ，Bot 立即可用`);
      setShowEditor(false);
      void loadProducts();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={<Space><AppstoreOutlined style={{ color: '#1677ff' }} /><span>产品管理</span></Space>}
      width={showEditor ? 860 : 480}
      extra={
        !showEditor ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>
            添加产品
          </Button>
        ) : null
      }
    >
      {!showEditor ? (
        /* Product List */
        <div>
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message="每个产品都有独立的 FAQ 和 Bot 目标。Bot 会根据客户咨询自动匹配对应产品知识库回答。" />
          {loadingProducts ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : products.length === 0 ? (
            <Empty description="还没有产品 — 点右上角「添加产品」开始">
              <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>添加第一个产品</Button>
            </Empty>
          ) : (
            products.map((kb) => (
              <ProductCard
                key={kb.id}
                kb={kb}
                onEdit={() => void openEditProduct(kb)}
                onDelete={() => void handleDeleteProduct(kb.id)}
              />
            ))
          )}
        </div>
      ) : (
        /* Editor / Wizard */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Button onClick={() => { setShowEditor(false); void loadProducts(); }}>← 返回产品列表</Button>
            <Text type="secondary">{editingKbId ? '编辑产品' : '新增产品'}</Text>
          </div>

          <Steps
            current={step}
            size="small"
            style={{ marginBottom: 24 }}
            items={[
              { title: '基本信息' },
              { title: '产品资料' },
              { title: '确认 FAQ' },
            ]}
          />

          {/* Step 0: Basic Info */}
          {step === 0 && (
            <Form form={form} layout="vertical">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="productName" label="产品名称" rules={[{ required: true }]}>
                    <Input placeholder="例如：M33 Lotto Bot" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="price" label="价格">
                    <Input placeholder="例如：RM 299/月 或「联系询价」" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="category" label="产品类别">
                <Select placeholder="选择类别" options={CATEGORY_OPTIONS.map(v => ({ value: v, label: v }))} />
              </Form.Item>
              <div style={{ textAlign: 'right' }}>
                <Button type="primary" onClick={() => { form.validateFields().then(() => setStep(1)).catch(() => {}); }}>
                  下一步 →
                </Button>
              </div>
            </Form>
          )}

          {/* Step 1: Product Content */}
          {step === 1 && (
            <div>
              <Tabs
                activeKey={inputMode}
                onChange={(k) => setInputMode(k as any)}
                items={[
                  {
                    key: 'text',
                    label: '粘贴产品描述',
                    children: (
                      <TextArea
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        autoSize={{ minRows: 10, maxRows: 20 }}
                        placeholder="把产品介绍、功能说明、常见问题、价格等资讯粘贴在这里。越详细，AI 生成的 FAQ 越准确（建议 300 字以上）。"
                        style={{ fontFamily: 'inherit' }}
                      />
                    ),
                  },
                  {
                    key: 'upload',
                    label: '上传介绍书 (PDF/Word)',
                    children: (
                      <div>
                        <Alert type="info" showIcon style={{ marginBottom: 12 }}
                          message="上传产品介绍书后系统会自动提取文字内容，用于 AI 生成 FAQ" />
                        <Upload.Dragger
                          accept=".pdf,.doc,.docx,.txt"
                          multiple={false}
                          showUploadList={false}
                          beforeUpload={async (file) => {
                            if (!form.getFieldValue('productName')) {
                              antdMessage.warning('请先填写产品名称');
                              return false;
                            }
                            try {
                              // Create a temp KB to upload source
                              const kbRes = await knowledgeApi.createKb({
                                name: `${form.getFieldValue('productName')} - 产品资料`,
                                type: 'product',
                                tenantId,
                                enabled: false, // temp
                              });
                              const tmpKbId = kbRes.data.id;
                              antdMessage.loading({ content: '正在解析文件...', key: 'upload' });
                              const srcRes = await knowledgeApi.uploadSource(tmpKbId, file);
                              const extractedText = srcRes.data?.rawText ?? '';
                              if (extractedText) {
                                setRawText(extractedText);
                                antdMessage.success({ content: `已提取 ${extractedText.length} 字内容`, key: 'upload' });
                              }
                              // Cleanup temp KB
                              await knowledgeApi.deleteKb(tmpKbId);
                            } catch {
                              antdMessage.error({ content: '文件解析失败', key: 'upload' });
                            }
                            return false;
                          }}
                        >
                          <p><UploadOutlined style={{ fontSize: 32, color: '#1677ff' }} /></p>
                          <p>点击或拖拽文件至此处</p>
                          <p style={{ color: '#999', fontSize: 12 }}>支持 PDF / Word / TXT，最大 20MB</p>
                        </Upload.Dragger>
                        {rawText && (
                          <Alert type="success" showIcon style={{ marginTop: 12 }}
                            message={`已提取 ${rawText.length} 字内容，可点「AI 生成」`} />
                        )}
                      </div>
                    ),
                  },
                ]}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <Button onClick={() => setStep(0)}>← 上一步</Button>
                <Button type="primary" icon={<RobotOutlined />}
                  onClick={handleGenerate} loading={generating}
                  disabled={!rawText.trim()}>
                  {generating ? `AI 正在生成 FAQ (30-50条)...` : '✨ AI 一键生成'}
                </Button>
              </div>
              {generating && (
                <Alert type="info" showIcon style={{ marginTop: 12 }}
                  message="AI 正在分析产品资料并生成 30-50 条 FAQ，请稍候（约 15-30 秒）..." />
              )}
            </div>
          )}

          {/* Step 2: Review & Edit */}
          {step === 2 && (
            <div>
              <Alert type="success" showIcon style={{ marginBottom: 16 }}
                message={`AI 已生成 ${faq.length} 条 FAQ。你可以编辑、删除或添加更多条目。`} />

              {/* Overview */}
              <Card size="small" style={{ marginBottom: 12 }}
                title={<Text strong>产品简介</Text>}>
                <TextArea value={overview} onChange={(e) => setOverview(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 5 }} style={{ fontFamily: 'inherit' }} />
              </Card>

              {/* Features */}
              {features.length > 0 && (
                <Card size="small" style={{ marginBottom: 12 }}
                  title={<Text strong>核心卖点</Text>}>
                  {features.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Badge color="blue" />
                      <Input size="small" value={f}
                        onChange={(e) => {
                          const next = [...features];
                          next[i] = e.target.value;
                          setFeatures(next);
                        }} />
                      <Button size="small" danger icon={<DeleteOutlined />}
                        onClick={() => setFeatures(features.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </Card>
              )}

              {/* Goal */}
              <Card size="small" style={{ marginBottom: 12 }}
                title={<Text strong>Bot 销售目标</Text>}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>Bot 会围绕此目标引导对话</Text>}>
                <Select
                  value={goal}
                  onChange={setGoal}
                  style={{ width: '100%' }}
                  options={GOAL_OPTIONS}
                />
              </Card>

              {/* FAQ List */}
              <Card size="small"
                title={<Text strong>FAQ 列表（{faq.length} 条）</Text>}
                extra={
                  <Button size="small" icon={<PlusOutlined />} type="dashed"
                    onClick={() => setFaq([...faq, { question: '', answer: '', tags: [] }])}>
                    添加
                  </Button>
                }
                style={{ marginBottom: 16 }}
              >
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {faq.map((item, i) => (
                    <div key={i} style={{
                      border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 10px',
                      marginBottom: 8, background: editingFaqIdx === i ? '#f0f7ff' : '#fafafa',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text strong style={{ fontSize: 12 }}>#{i + 1}</Text>
                        <Space size={4}>
                          <Button size="small" icon={<EditOutlined />}
                            onClick={() => setEditingFaqIdx(editingFaqIdx === i ? null : i)} />
                          <Button size="small" danger icon={<DeleteOutlined />}
                            onClick={() => setFaq(faq.filter((_, j) => j !== i))} />
                        </Space>
                      </div>
                      {editingFaqIdx === i ? (
                        <>
                          <Input size="small" value={item.question} style={{ marginBottom: 4 }}
                            onChange={(e) => {
                              const next = [...faq]; next[i] = { ...next[i], question: e.target.value };
                              setFaq(next);
                            }} placeholder="问题" />
                          <TextArea size="small" value={item.answer} autoSize={{ minRows: 2 }}
                            onChange={(e) => {
                              const next = [...faq]; next[i] = { ...next[i], answer: e.target.value };
                              setFaq(next);
                            }} placeholder="回答" />
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>Q: {item.question}</div>
                          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>A: {item.answer.slice(0, 100)}{item.answer.length > 100 ? '…' : ''}</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button onClick={() => setStep(1)}>← 返回修改</Button>
                <Button type="primary" icon={<CheckCircleOutlined />}
                  onClick={handleSave} loading={saving}>
                  保存产品 ({faq.length} 条 FAQ)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
