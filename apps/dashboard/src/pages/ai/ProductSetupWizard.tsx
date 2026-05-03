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
          <Button size="small" icon={<EditOutlined />} onClick={onEdit}>编辑</Button>
          <Popconfirm title="确认删除此产品？" onConfirm={onDelete} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
    </Card>
  );
}

// ── 主组件：5 步引导式 ─────────────────────────────────────────────────
export default function ProductSetupWizard({ open, onClose, tenantId }: Props) {
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);

  // Wizard state
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<ProductForm>();
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
    form.setFieldsValue({ customerType: 'mixed', goalKey: 'general', useCompanyFallback: true });
  };

  const openNewProduct = () => { resetWizard(); setShowEditor(true); };

  const openEditProduct = async (kb: any) => {
    resetWizard();
    setEditingKbId(kb.id);
    try {
      const saved = JSON.parse(kb.description ?? '{}');
      form.setFieldsValue({
        productName: saved.productName ?? kb.name.replace(' - 产品资料', ''),
        price: saved.price,
        category: saved.category,
        customerType: saved.customerType ?? 'mixed',
        goalKey: saved.goalKey ?? 'general',
        useCompanyFallback: saved.useCompanyFallback ?? true,
      });
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
      setStep(4); // → 确认页
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请重试');
    } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    let values: ProductForm;
    try { values = await form.validateFields(); } catch { return; }

    setSaving(true);
    try {
      const goalPrompt = buildGoalPrompt(values.goalKey);
      const dto = {
        name: `${values.productName} - 产品资料`,
        type: 'product',
        description: JSON.stringify({
          productName: values.productName,
          price: values.price,
          category: values.category,
          customerType: values.customerType,
          goalKey: values.goalKey,
          useCompanyFallback: values.useCompanyFallback,
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
      antdMessage.success(`产品已保存，含 ${faq.length} 条 FAQ ✅`);
      setShowEditor(false);
      void loadProducts();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
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
      title={<Space><AppstoreOutlined style={{ color: '#1677ff' }} /><span>产品管理</span></Space>}
      width={showEditor ? 880 : 480}
      extra={!showEditor ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>添加产品</Button>
      ) : null}
    >
      {!showEditor ? (
        <div>
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message="每个产品都有独立的 FAQ 和 Bot 销售目标。Bot 会根据客户咨询自动匹配对应产品知识库回答。" />
          {loadingProducts ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : products.length === 0 ? (
            <Empty description="还没有产品 — 点右上角「添加产品」开始">
              <Button type="primary" icon={<PlusOutlined />} onClick={openNewProduct}>添加第一个产品</Button>
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
            <Button onClick={() => { setShowEditor(false); void loadProducts(); }}>← 返回产品列表</Button>
            <Text type="secondary">{editingKbId ? '编辑产品' : `新增产品 · 第 ${step + 1}/5 步`}</Text>
          </div>

          <Steps
            current={step}
            size="small"
            style={{ marginBottom: 24 }}
            items={[
              { title: '欢迎' },
              { title: '基本信息' },
              { title: '业务目标' },
              { title: '上传资料' },
              { title: '确认 FAQ' },
            ]}
          />

          <Form form={form} layout="vertical" initialValues={{ customerType: 'mixed', goalKey: 'general', useCompanyFallback: true }}>

            {/* Step 0: 欢迎页 */}
            {step === 0 && (
              <Card style={{ textAlign: 'center', background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                <RocketOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
                <Title level={3} style={{ margin: 0 }}>📦 创建产品知识库</Title>
                <Paragraph style={{ marginTop: 16, fontSize: 14 }}>
                  接下来 <strong>4 个步骤</strong>，你可以：
                </Paragraph>
                <div style={{ textAlign: 'left', maxWidth: 380, margin: '0 auto', fontSize: 13, lineHeight: 2 }}>
                  ✅ 填基本信息 → 选 Bot 销售目标<br/>
                  ✅ 上传产品介绍书 (PDF / Word)<br/>
                  ✅ AI 自动生成 <strong>30-50 条 FAQ</strong><br/>
                  ✅ Bot 立即学会回答这个产品的问题
                </div>
                <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
                  整个过程约 1-2 分钟。不用懂技术，按步骤填就行。
                </Paragraph>
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => setStep(1)}>
                  开始
                </Button>
              </Card>
            )}

            {/* Step 1: 基本信息 + 客户类型 */}
            {step === 1 && (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 16 }}
                  message="基本信息" description="填产品的名字和价格，Bot 用来识别和回答客户。" />
                <Row gutter={12}>
                  <Col span={14}>
                    <Form.Item name="productName" label="产品名称" rules={[{ required: true, message: '必填' }]}>
                      <Input placeholder="例如：M33 Lotto Bot 自动化系统" />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item name="price" label="价格" extra="可填具体数字 / 联系询价 / 按需报价">
                      <Input placeholder="例如：RM 299/月" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="category" label="产品类别（可选）">
                  <Select placeholder="选择类别" allowClear
                    options={CATEGORY_OPTIONS.map(v => ({ value: v, label: v }))} />
                </Form.Item>
                <Form.Item name="customerType" label="客户类型（影响 Bot 语气）"
                  extra="To B 偏专业正式 / To C 偏亲切轻松 / 混合则中性">
                  <Radio.Group>
                    <Radio.Button value="b2b">🏢 To B 企业</Radio.Button>
                    <Radio.Button value="mixed">⚖️ 混合（推荐）</Radio.Button>
                    <Radio.Button value="b2c">👤 To C 个人</Radio.Button>
                  </Radio.Group>
                </Form.Item>
              </>
            )}

            {/* Step 2: 业务目标 */}
            {step === 2 && (
              <>
                <Alert type="info" showIcon style={{ marginBottom: 16 }}
                  message="Bot 和客户聊到最后，要引导客户做什么？"
                  description="选一个最贴近你业务的目标。Bot 会自然地朝这个目标推进对话。" />

                <Form.Item name="goalKey" label="销售目标">
                  <Select size="large" placeholder="选择推荐目标"
                    optionLabelProp="label">
                    {GOAL_OPTIONS.map(opt => (
                      <Select.Option key={opt.value} value={opt.value}
                        label={<span>{opt.icon} {opt.label}{opt.recommended && ' ⭐ 推荐'}</span>}>
                        <div style={{ padding: '4px 0' }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {opt.icon} {opt.label}
                            {opt.recommended && <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>推荐</Tag>}
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
                      <strong>用「公司通用 FAQ」兜底</strong>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                        当客户问的问题不在产品 FAQ 里，自动用公司通用 FAQ 回答（推荐开启）
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
                  message="上传产品介绍书 → AI 一键生成 FAQ"
                  description="资料越详细，AI 生成的 FAQ 越准确（建议 300 字以上）。" />

                <Tabs activeKey={inputMode} onChange={(k) => setInputMode(k as any)}
                  items={[
                    {
                      key: 'upload',
                      label: <span>📄 上传介绍书 (PDF/Word)</span>,
                      children: (
                        <div>
                          <Upload.Dragger
                            accept=".pdf,.doc,.docx,.txt"
                            multiple={false}
                            showUploadList={false}
                            beforeUpload={async (file) => {
                              if (!form.getFieldValue('productName')) {
                                antdMessage.warning('请先回上一步填写产品名称');
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
                                antdMessage.loading({ content: '正在解析文件...', key: 'up' });
                                const srcRes = await knowledgeApi.uploadSource(tmpId, file);
                                const txt = srcRes.data?.rawText ?? '';
                                if (txt) {
                                  setRawText(txt);
                                  setUploadedFileName(file.name);
                                  antdMessage.success({ content: `已从「${file.name}」提取 ${txt.length} 字`, key: 'up' });
                                }
                                await knowledgeApi.deleteKb(tmpId);
                              } catch {
                                antdMessage.error({ content: '文件解析失败', key: 'up' });
                              }
                              return false;
                            }}
                          >
                            {uploadedFileName ? (
                              <>
                                <p style={{ fontSize: 32, color: '#52c41a' }}>✅</p>
                                <p style={{ fontWeight: 600 }}>已上传：{uploadedFileName}</p>
                                <p style={{ color: '#999', fontSize: 12 }}>已提取 {rawText.length} 字内容</p>
                              </>
                            ) : (
                              <>
                                <p><UploadOutlined style={{ fontSize: 32, color: '#1677ff' }} /></p>
                                <p>点击或拖拽文件至此处</p>
                                <p style={{ color: '#999', fontSize: 12 }}>支持 PDF / Word / TXT，最大 20MB</p>
                              </>
                            )}
                          </Upload.Dragger>
                        </div>
                      ),
                    },
                    {
                      key: 'text',
                      label: <span>✍️ 手动粘贴</span>,
                      children: (
                        <TextArea
                          value={rawText}
                          onChange={(e) => setRawText(e.target.value)}
                          autoSize={{ minRows: 10, maxRows: 20 }}
                          placeholder="把产品介绍、功能说明、价格、常见问题等资讯粘贴在这里。&#10;&#10;越详细越好，AI 会自动从中生成 30-50 条 FAQ。"
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
                  <Empty description="还没有生成 FAQ" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                    <Button type="primary" icon={<RobotOutlined />} onClick={() => setStep(3)}>
                      返回上传资料
                    </Button>
                  </Empty>
                ) : (
                  <>
                    <Alert type="success" showIcon style={{ marginBottom: 16 }}
                      message={`AI 已生成 ${faq.length} 条 FAQ ✅`}
                      description="可逐条编辑、删除或添加更多。满意后点「保存产品」。" />

                    <Card size="small" style={{ marginBottom: 12 }} title={<Text strong>📋 产品简介</Text>}>
                      <TextArea value={overview} onChange={(e) => setOverview(e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 5 }} style={{ fontFamily: 'inherit' }} />
                    </Card>

                    {features.length > 0 && (
                      <Card size="small" style={{ marginBottom: 12 }} title={<Text strong>⭐ 核心卖点</Text>}>
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
                      title={<Text strong>📋 FAQ 列表（{faq.length} 条）</Text>}
                      extra={
                        <Button size="small" icon={<PlusOutlined />} type="dashed"
                          onClick={() => setFaq([...faq, { question: '', answer: '', tags: [] }])}>
                          添加
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
                                  }} placeholder="问题" />
                                <TextArea size="small" value={item.answer} autoSize={{ minRows: 2 }}
                                  onChange={(e) => {
                                    const next = [...faq]; next[i] = { ...next[i], answer: e.target.value }; setFaq(next);
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
                  </>
                )}
              </>
            )}
          </Form>

          {/* 底部操作栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
            <div>
              {step > 0 && step !== 4 && (
                <Button icon={<ArrowLeftOutlined />} onClick={goBack}>上一步</Button>
              )}
              {step === 4 && (
                <Button icon={<ArrowLeftOutlined />} onClick={() => setStep(3)}>返回修改</Button>
              )}
            </div>
            <div>
              {step === 0 && (
                <Button type="primary" size="large" icon={<ArrowRightOutlined />} onClick={() => setStep(1)}>
                  开始
                </Button>
              )}
              {(step === 1 || step === 2) && (
                <Button type="primary" icon={<ArrowRightOutlined />} onClick={goNext}>下一步</Button>
              )}
              {step === 3 && (
                <Tooltip title={!rawText.trim() ? '请先上传介绍书或粘贴产品描述' : ''}>
                  <Button type="primary" icon={<RobotOutlined />}
                    onClick={handleGenerate} loading={generating}
                    disabled={!rawText.trim()}>
                    {generating ? `AI 生成中 (30-50条)...` : '✨ AI 一键生成'}
                  </Button>
                </Tooltip>
              )}
              {step === 4 && (
                <Button type="primary" icon={<CheckCircleOutlined />}
                  onClick={handleSave} loading={saving}>
                  ✓ 保存产品 ({faq.length} 条 FAQ)
                </Button>
              )}
            </div>
          </div>

          {generating && (
            <Alert type="info" showIcon style={{ marginTop: 16 }}
              message="AI 正在分析产品资料并生成 30-50 条 FAQ" description="约 15-30 秒，请稍候..." />
          )}
        </div>
      )}
    </Drawer>
  );
}
