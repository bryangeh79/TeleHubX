import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Checkbox, Col, Drawer, Empty, Form, Input,
  Modal, Popconfirm, Radio, Row, Select, Space, Spin, Steps, Tabs, Tag, Tooltip,
  Typography, Upload, message as antdMessage,
} from 'antd';
import {
  AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined,
  DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined, RocketOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { knowledgeApi } from '../../services/api';
import { useT } from '../../i18n';

const { Text, Title, Paragraph } = Typography;
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
  customerType: 'b2b' | 'b2c' | 'mixed';
  goalKey: string;
  useCompanyFallback: boolean;
}

// ── 8 个业务目标（参考 WAhubX）─────────────────────────────────────────
const GOAL_OPTIONS = [
  {
    value: 'general',
    icon: '🎯',
    label: '综合，不确定时用',
    desc: '客户问什么 Bot 都能聊，不强推某个动作',
    recommended: true,
  },
  {
    value: 'collect_contact',
    icon: '💬',
    label: '收集联系方式',
    desc: '引导客户留下 WhatsApp / 邮箱 / 电话',
  },
  {
    value: 'book_demo',
    icon: '📅',
    label: '引导预约',
    desc: '到店 / 看房 / 试听 / Demo / 体验',
  },
  {
    value: 'close_purchase',
    icon: '🛒',
    label: '促成下单 / 购买',
    desc: '直接转化为订单',
  },
  {
    value: 'join_community',
    icon: '👥',
    label: '引导加社群 / 关注',
    desc: 'WhatsApp 群 / Telegram / Facebook / WeChat',
  },
  {
    value: 'request_quote',
    icon: '💰',
    label: '询价 / 申请报价',
    desc: '收集需求后转销售给报价',
  },
  {
    value: 'send_material',
    icon: '📄',
    label: '发送资料',
    desc: '产品手册 / 案例 / 价格表',
  },
  {
    value: 'qualify_leads',
    icon: '🎯',
    label: '筛选高意向客户',
    desc: '问几个关键问题，高意向才转人工',
  },
];

// 把 goalKey 转成 system prompt 用的中文目标描述
function buildGoalPrompt(goalKey: string): string {
  const opt = GOAL_OPTIONS.find(g => g.value === goalKey);
  if (!opt || goalKey === 'general') return '综合性对话，根据客户实际需求灵活引导，不强推某个特定动作';
  const promptMap: Record<string, string> = {
    collect_contact: '你的核心目标是收集客户联系方式（WhatsApp / 邮箱 / 电话）。在自然对话中找机会要联系方式，确认后转人工销售跟进。',
    book_demo: '你的核心目标是引导客户预约 Demo / 试听 / 体验 / 看房。客户表现兴趣后立即问时间，确认后转人工销售。',
    close_purchase: '你的核心目标是促成客户下单。简明介绍产品价值，及时把客户引导到付款环节，遇到议价或个性化需求转人工。',
    join_community: '你的核心目标是引导客户加入社群（WhatsApp 群 / Telegram / Facebook / WeChat）。主动提供入群链接或邀请码。',
    request_quote: '你的核心目标是引导客户提交报价请求。收集关键信息（用量、规模、需求），整理后转人工销售给客户准确报价。',
    send_material: '你的核心目标是发送资料给客户（产品手册 / 案例 / 价格表）。先确认客户需求方向，再让人工销售发对应资料。',
    qualify_leads: '你的核心目标是筛选高意向客户。问 2-3 个关键问题（预算 / 使用场景 / 决策时间），判定为高意向才转人工。',
  };
  return promptMap[goalKey] ?? opt.desc;
}

const CATEGORY_OPTIONS = [
  'SaaS 软件', '硬件/设备', '咨询服务', '培训课程',
  '金融产品', '健康/美容', '食品/餐饮', '房产', '其他',
];

// ── 产品列表卡 ─────────────────────────────────────────────────────────
function ProductCard({ kb, onEdit, onDelete }: { kb: any; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  let info: any = {};
  try { info = JSON.parse(kb.description ?? '{}'); } catch {}
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 14 }}>{info.productName ?? kb.name.replace(' - 产品资料', '')}</Text>
          <Space size={4} wrap style={{ marginLeft: 8 }}>
            {info.price && <Tag color="orange" style={{ fontSize: 10 }}>{info.price}</Tag>}
            {info.category && <Tag color="default" style={{ fontSize: 10 }}>{info.category}</Tag>}
          </Space>
          {kb.goalPrompt && (
            <div style={{ marginTop: 4 }}>
              <Tag color="blue" style={{ fontSize: 11 }}>🎯 {kb.goalPrompt.slice(0, 30)}{kb.goalPrompt.length > 30 ? '...' : ''}</Tag>
            </div>
          )}
        </div>
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={onEdit}>{t('product.editBtn')}</Button>
          <Popconfirm title={t('product.deleteConfirm')} onConfirm={onDelete} okText={t('common.delete')} okButtonProps={{ danger: true }} cancelText={t('common.cancel')}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}

// ── 主组件：5 步引导式 ─────────────────────────────────────────────────
export default function ProductSetupWizard({ open, onClose, tenantId }: Props) {
  const t = useT();
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);

  // Wizard state
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<ProductForm>();
  // 用 useState 镜像 form 值，跨步骤切换时不丢失（form.getFieldValue 偶尔在 unmount 后失效）
  const [formMirror, setFormMirror] = useState<Partial<ProductForm>>({
    customerType: 'mixed', goalKey: 'general', useCompanyFallback: true,
  });
  const [inputMode, setInputMode] = useState<'upload' | 'text'>('upload');
  const [rawText, setRawText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Generated result
  const [overview, setOverview] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [faq, setFaq] = useState<ProductFaq[]>([]);
  const [editingFaqIdx, setEditingFaqIdx] = useState<number | null>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await knowledgeApi.listKbs({ type: 'product' });
      setProducts((res.data ?? []).filter((k: any) => !tenantId || k.tenantId === tenantId));
    } catch {} finally { setLoadingProducts(false); }
  }, [tenantId]);

  useEffect(() => { if (open) void loadProducts(); }, [open, loadProducts]);

  const resetWizard = () => {
    setStep(0);
    setRawText('');
    setUploadedFileName('');
    setOverview('');
    setFeatures([]);
    setFaq([]);
    setEditingKbId(null);
    setInputMode('upload');
    form.resetFields();
    const defaults = { customerType: 'mixed' as const, goalKey: 'general', useCompanyFallback: true };
    form.setFieldsValue(defaults);
    setFormMirror(defaults);
  };

  const openNewProduct = () => { resetWizard(); setShowEditor(true); };

  const openEditProduct = async (kb: any) => {
    resetWizard();
    setEditingKbId(kb.id);
    try {
      const saved = JSON.parse(kb.description ?? '{}');
      const formData = {
        productName: saved.productName ?? kb.name.replace(' - 产品资料', ''),
        price: saved.price,
        category: saved.category,
        customerType: saved.customerType ?? 'mixed',
        goalKey: saved.goalKey ?? 'general',
        useCompanyFallback: saved.useCompanyFallback ?? true,
      };
      form.setFieldsValue(formData);
      setFormMirror(formData);
      setOverview(saved.overview ?? '');
      setFeatures(saved.features ?? []);
      const faqRes = await knowledgeApi.listFaqs({ kbId: kb.id });
      setFaq((faqRes.data ?? []).map((f: any) => ({ question: f.question, answer: f.answer, tags: f.tags ?? [] })));
      setStep(4); // Jump to review step
    } catch {}
    setShowEditor(true);
  };

  const handleDeleteProduct = async (kbId: string) => {
    try {
      await knowledgeApi.deleteKb(kbId);
      antdMessage.success(t('product.deleteOk'));
      void loadProducts();
    } catch { antdMessage.error(t('msg.deleteFailed')); }
  };

  const handleGenerate = async () => {
    // 优先读 formMirror（跨步骤永不丢失），form 作为 fallback
    const productName = (formMirror.productName ?? form.getFieldValue('productName') ?? '').trim();
    const price = formMirror.price ?? form.getFieldValue('price');
    if (!productName) {
      antdMessage.warning(t('product.gen.nameRequired'));
      setStep(1);
      return;
    }
    if (!rawText.trim()) { antdMessage.warning(t('product.gen.descRequired')); return; }

    setGenerating(true);
    try {
      const res = await knowledgeApi.generateProductProfile({
        productName,
        price,
        rawText,
      });
      setOverview(res.data.overview ?? '');
      setFeatures(res.data.features ?? []);
      setFaq(res.data.faq ?? []);
      setStep(4); // → 确认页
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('product.gen.fail'));
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    // 合并 form 实时值 + formMirror（跨步骤备份）
    const fv = { ...formMirror, ...form.getFieldsValue() } as ProductForm;
    if (!fv.productName?.trim()) {
      antdMessage.warning(t('product.save.nameRequired'));
      setStep(1);
      return;
    }

    setSaving(true);
    try {
      const goalPrompt = buildGoalPrompt(fv.goalKey ?? 'general');
      const dto = {
        name: `${fv.productName} - 产品资料`,
        type: 'product',
        description: JSON.stringify({
          productName: fv.productName,
          price: fv.price,
          category: fv.category,
          customerType: fv.customerType ?? 'mixed',
          goalKey: fv.goalKey ?? 'general',
          useCompanyFallback: fv.useCompanyFallback ?? true,
          overview, features,
        }),
        goalPrompt,
        tenantId,
        enabled: true,
      };

      let kbId: string;
      if (editingKbId) {
        await knowledgeApi.updateKb(editingKbId, dto);
        kbId = editingKbId;
        const oldFaqs = await knowledgeApi.listFaqs({ kbId });
        for (const f of (oldFaqs.data ?? [])) await knowledgeApi.deleteFaq(f.id);
      } else {
        const res = await knowledgeApi.createKb(dto);
        kbId = res.data.id;
      }
      if (faq.length > 0) {
        await knowledgeApi.bulkImport(kbId, faq.map(f => ({ question: f.question, answer: f.answer, tags: f.tags })));
      }
      antdMessage.success(t('product.save.ok', { count: faq.length }));
      setShowEditor(false);
      void loadProducts();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    } finally { setSaving(false); }
  };

  const goNext = async () => {
    if (step === 1) {
      try { await form.validateFields(['productName']); } catch { return; }
    }
    setStep(s => s + 1);
  };
  const goBack = () => setStep(s => Math.max(0, s - 1));

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={<Space><AppstoreOutlined style={{ color: '#1677ff' }} /><span>{t('product.title')}</span></Space>}
      width={showEditor ? 880 : 480}
      extra={!showEditor ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>{t('product.add')}</Button>
      ) : null}
    >
      {!showEditor ? (
        <div>
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message={t('product.intro')} />
          {loadingProducts ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : products.length === 0 ? (
            <Empty description={t('product.empty')}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>{t('product.addFirst')}</Button>
            </Empty>
          ) : (
            products.map((kb) => (
              <ProductCard key={kb.id} kb={kb}
                onEdit={() => void openEditProduct(kb)}
                onDelete={() => void handleDeleteProduct(kb.id)} />
            ))
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Button onClick={() => { setShowEditor(false); void loadProducts(); }}>← {t('common.back')}</Button>
            <Text type="secondary">{editingKbId ? t('cs.product.edit') : `${t('cs.product.new')} · ${step + 1}/5`}</Text>
          </div>

          <Steps
            current={step}
            size="small"
            style={{ marginBottom: 24 }}
            items={[
              { title: t('cs.product.step.welcome') },
              { title: t('cs.product.step.basic') },
              { title: t('cs.product.step.goal') },
              { title: t('cs.product.step.upload') },
              { title: t('cs.product.step.faq') },
            ]}
          />

          <Form
            form={form}
            layout="vertical"
            preserve={true}
            initialValues={{ customerType: 'mixed', goalKey: 'general', useCompanyFallback: true }}
            onValuesChange={(_, all) => setFormMirror(prev => ({ ...prev, ...all }))}
          >

            {/* Step 0: 欢迎页 */}
            {step === 0 && (
              <Card style={{ textAlign: 'center', background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                <RocketOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
                <Title level={3} style={{ margin: 0 }}>📦 {t('cs.product.welcome.title')}</Title>
                <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
                  {t('cs.product.welcome.desc')}
                </Paragraph>
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => setStep(1)}>
                  {t('common.start')}
                </Button>
              </Card>
            )}

            {/* Step 1: 基本信息 + 客户类型 */}
            {step === 1 && (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 16 }}
                  message={t('cs.product.step.basic')} />
                <Row gutter={12}>
                  <Col span={14}>
                    <Form.Item name="productName" label={t('cs.product.field.name')} rules={[{ required: true, message: t('form.required') }]}>
                      <Input placeholder={t('form.placeholder.required')} />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item name="price" label={t('cs.product.field.price')}>
                      <Input placeholder={t('form.placeholder.required')} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="category" label={t('cs.product.field.category')}>
                  <Select placeholder={t('form.placeholder.optional')} allowClear
                    options={CATEGORY_OPTIONS.map(v => ({ value: v, label: v }))} />
                </Form.Item>
                <Form.Item name="customerType" label={t('product.field.customerType')}
                  extra={t('product.field.customerTypeHint')}>
                  <Radio.Group>
                    <Radio.Button value="b2b">{t('product.field.customerType.b2b')}</Radio.Button>
                    <Radio.Button value="mixed">{t('product.field.customerType.mixed')}</Radio.Button>
                    <Radio.Button value="b2c">{t('product.field.customerType.b2c')}</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </>
            )}

            {/* Step 2: 业务目标 */}
            {step === 2 && (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 16 }}
                  message={t('product.goal.alert.title')}
                  description={t('product.goal.alert.desc')} />

                <Form.Item name="goalKey" label={t('product.goal.label')}>
                  <Select size="large" placeholder={t('product.goal.placeholder')}
                    optionLabelProp="label">
                    {GOAL_OPTIONS.map(opt => (
                      <Select.Option key={opt.value} value={opt.value}
                        label={<span>{opt.icon} {opt.label}{opt.recommended && ` ⭐ ${t('product.goal.recommended')}`}</span>}>
                        <div style={{ padding: '4px 0' }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {opt.icon} {opt.label}
                            {opt.recommended && <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>{t('product.goal.recommended')}</Tag>}
                          </div>
                          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{opt.desc}</div>
                        </div>
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>

                <Card size="small" style={{ marginTop: 16, background: '#f0f7ff', border: '1px solid #91caff' }}>
                  <Form.Item name="useCompanyFallback" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Checkbox>
                      <strong>{t('product.goal.fallback.title')}</strong>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        {t('product.goal.fallback.desc')}
                      </div>
                    </Checkbox>
                  </Form.Item>
                </Card>
              </>
            )}

            {/* Step 3: 上传产品资料 */}
            {step === 3 && (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 16 }}
                  message={t('product.upload.alert.title')}
                  description={t('product.upload.alert.desc')} />

                <Tabs activeKey={inputMode} onChange={(k) => setInputMode(k as any)}
                  items={[
                    {
                      key: 'upload',
                      label: <span>{t('product.upload.tabFile')}</span>,
                      children: (
                        <div>
                          <Upload.Dragger
                            accept=".pdf,.doc,.docx,.txt"
                            multiple={false}
                            showUploadList={false}
                            beforeUpload={async (file) => {
                              const pn = formMirror.productName ?? form.getFieldValue('productName');
                              if (!pn?.trim()) {
                                antdMessage.warning(t('product.upload.nameRequired'));
                                return false;
                              }
                              try {
                                const kbRes = await knowledgeApi.createKb({
                                  name: `_tmp_product_upload`,
                                  type: 'product',
                                  tenantId,
                                  enabled: false,
                                });
                                const tmpId = kbRes.data.id;
                                antdMessage.loading({ content: t('product.upload.parsing'), key: 'up' });
                                const srcRes = await knowledgeApi.uploadSource(tmpId, file);
                                const txt = srcRes.data?.rawText ?? '';
                                if (txt) {
                                  setRawText(txt);
                                  setUploadedFileName(file.name);
                                  antdMessage.success({ content: t('product.upload.extracted', { name: file.name, count: txt.length }), key: 'up' });
                                }
                                await knowledgeApi.deleteKb(tmpId);
                              } catch {
                                antdMessage.error({ content: t('product.upload.parseFail'), key: 'up' });
                              }
                              return false;
                            }}
                          >
                            {uploadedFileName ? (
                              <>
                                <p style={{ fontSize: 32, color: '#52c41a' }}>✅</p>
                                <p style={{ fontWeight: 600 }}>{t('product.upload.uploaded', { name: uploadedFileName })}</p>
                                <p style={{ color: '#999', fontSize: 12 }}>{t('product.upload.extractedSize', { count: rawText.length })}</p>
                              </>
                            ) : (
                              <>
                                <p><UploadOutlined style={{ fontSize: 32, color: '#1677ff' }} /></p>
                                <p>{t('product.upload.click')}</p>
                                <p style={{ color: '#999', fontSize: 12 }}>{t('product.upload.formatHint')}</p>
                              </>
                            )}
                          </Upload.Dragger>
                        </div>
                      ),
                    },
                    {
                      key: 'text',
                      label: <span>{t('product.upload.tabText')}</span>,
                      children: (
                        <TextArea
                          value={rawText}
                          onChange={(e) => setRawText(e.target.value)}
                          autoSize={{ minRows: 10, maxRows: 20 }}
                          placeholder={t('product.upload.placeholder')}
                          style={{ fontFamily: 'inherit' }}
                        />
                      ),
                    },
                  ]}
                />
              </>
            )}

            {/* Step 4: 确认 FAQ */}
            {step === 4 && (
              <>
                {faq.length === 0 && !generating ? (
                  <Empty description={t('product.review.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                    <Button type="primary" icon={<RobotOutlined />} onClick={() => setStep(3)}>
                      {t('product.review.backToUpload')}
                    </Button>
                  </Empty>
                ) : (
                  <>
                    <Alert type="success" showIcon style={{ marginBottom: 16 }}
                      message={t('product.review.alert.title', { count: faq.length })}
                      description={t('product.review.alert.desc')} />

                    <Card size="small" style={{ marginBottom: 12 }} title={<Text strong>{t('product.review.overview')}</Text>}>
                      <TextArea value={overview} onChange={(e) => setOverview(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 5 }} style={{ fontFamily: 'inherit' }} />
                    </Card>

                    {features.length > 0 && (
                      <Card size="small" style={{ marginBottom: 12 }} title={<Text strong>{t('product.review.features')}</Text>}>
                        {features.map((f, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <Badge color="blue" />
                            <Input size="small" value={f}
                              onChange={(e) => {
                                const next = [...features]; next[i] = e.target.value; setFeatures(next);
                              }} />
                            <Button size="small" danger icon={<DeleteOutlined />}
                              onClick={() => setFeatures(features.filter((_, j) => j !== i))} />
                          </div>
                        ))}
                      </Card>
                    )}

                    <Card size="small"
                      title={<Text strong>{t('product.review.faqList', { count: faq.length })}</Text>}
                      extra={
                        <Button size="small" icon={<PlusOutlined />} type="dashed"
                          onClick={() => setFaq([...faq, { question: '', answer: '', tags: [] }])}>
                          {t('product.review.faqAdd')}
                        </Button>
                      }
                    >
                      <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                        {faq.map((item, i) => (
                          <div key={i} style={{
                            border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 10px',
                            marginBottom: 6, background: editingFaqIdx === i ? '#f0f7ff' : '#fafafa',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <Text strong style={{ fontSize: 12 }}>#{i + 1}</Text>
                              <Space size={2}>
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
                                    const next = [...faq]; next[i] = { ...next[i], question: e.target.value }; setFaq(next);
                                  }} placeholder={t('product.review.faqQ')} />
                                <TextArea size="small" value={item.answer} autoSize={{ minRows: 2 }}
                                  onChange={(e) => {
                                    const next = [...faq]; next[i] = { ...next[i], answer: e.target.value }; setFaq(next);
                                  }} placeholder={t('product.review.faqA')} />
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
                  </>
                )}
              </>
            )}
          </Form>

          {/* 底部操作栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
            <div>
              {step > 0 && step !== 4 && (
                <Button icon={<ArrowLeftOutlined />} onClick={goBack}>{t('product.nav.prev')}</Button>
              )}
              {step === 4 && (
                <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(3)}>{t('product.review.editGuide')}</Button>
              )}
            </div>
            <div>
              {step === 0 && (
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => setStep(1)}>
                  {t('product.nav.start')}
                </Button>
              )}
              {(step === 1 || step === 2) && (
                <Button type="primary" icon={<ArrowRightOutlined />} onClick={goNext}>{t('product.nav.next')}</Button>
              )}
              {step === 3 && (
                <Tooltip title={!rawText.trim() ? t('product.gen.tooltip') : ''}>
                  <Button type="primary" icon={<RobotOutlined />}
                    onClick={handleGenerate} loading={generating}
                    disabled={!rawText.trim()}>
                    {generating ? t('product.gen.btnLoading') : t('product.gen.btn')}
                  </Button>
                </Tooltip>
              )}
              {step === 4 && (
                <Button type="primary" icon={<CheckCircleOutlined />}
                  onClick={handleSave} loading={saving}>
                  {t('product.save.btn', { count: faq.length })}
                </Button>
              )}
            </div>
          </div>

          {generating && (
            <Alert type="info" showIcon style={{ marginTop: 16 }}
              message={t('product.gen.spinAlert.title')} description={t('product.gen.spinAlert.desc')} />
          )}
        </div>
      )}
    </Drawer>
  );
}
