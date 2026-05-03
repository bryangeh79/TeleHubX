import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Divider, Form, Input, message as antdMessage,
  Modal, Row, Select, Space, Spin, Steps, Tag, Tooltip, Typography, Upload,
} from 'antd';
import {
  BankOutlined, CheckCircleOutlined, DeleteOutlined,
  EditOutlined, GlobalOutlined, PlusOutlined, RobotOutlined, UploadOutlined,
} from '@ant-design/icons';
import { knowledgeApi } from '../../services/api';

const { Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

interface ContactEntry { type: string; value: string }

const CONTACT_TYPES = [
  { value: 'WhatsApp',  label: 'WhatsApp',  placeholder: 'https://wa.me/601234...' },
  { value: 'Telegram',  label: 'Telegram',  placeholder: '@YourTelegramID' },
  { value: 'WeChat',    label: 'WeChat',    placeholder: 'WeChat ID 或二维码链接' },
  { value: 'Zalo',      label: 'Zalo',      placeholder: 'https://zalo.me/...' },
  { value: 'Line',      label: 'Line',      placeholder: 'Line ID 或 https://line.me/ti/...' },
];

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TIMES = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00',
  '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00', '22:00', '23:00',
];

const INDUSTRY_OPTIONS = [
  'SaaS / 软件服务', '电商 / 零售', '教育 / 培训', '金融 / 保险',
  '餐饮 / 食品', '医疗 / 健康', '房地产', '制造业', '咨询 / 服务', '其他',
];

export default function CompanyInfoWizard({ open, onClose, tenantId }: Props) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm();

  // Contact list
  const [contacts, setContacts] = useState<ContactEntry[]>([{ type: 'WhatsApp', value: '' }]);

  // Business hours
  const [hoursFrom, setHoursFrom] = useState('周一');
  const [hoursTo, setHoursTo] = useState('周五');
  const [timeFrom, setTimeFrom] = useState('09:00');
  const [timeTo, setTimeTo] = useState('18:00');

  // Brochure / website
  const [extraText, setExtraText] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');

  // AI result
  const [generatedProfile, setGeneratedProfile] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existingKbId, setExistingKbId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setGeneratedProfile('');
    setExtraText('');
    setUploadedFileName('');
    knowledgeApi.listKbs({ type: 'company' }).then((res) => {
      const existing = (res.data ?? []).find((kb: any) => !tenantId || kb.tenantId === tenantId);
      if (existing) {
        setExistingKbId(existing.id);
        try {
          const saved = JSON.parse(existing.description ?? '{}');
          form.setFieldsValue({
            companyName: saved.companyName,
            industry: saved.industry,
            about: saved.about,
            email: saved.email,
            website: saved.website,
          });
          if (saved.contacts?.length) setContacts(saved.contacts);
          if (saved.hoursFrom) setHoursFrom(saved.hoursFrom);
          if (saved.hoursTo) setHoursTo(saved.hoursTo);
          if (saved.timeFrom) setTimeFrom(saved.timeFrom);
          if (saved.timeTo) setTimeTo(saved.timeTo);
        } catch {}
        setGeneratedProfile(existing.goalPrompt ?? '');
      }
    }).catch(() => {});
  }, [open]);

  const handleFetchUrl = async () => {
    const website = form.getFieldValue('website');
    if (!website?.startsWith('http')) { antdMessage.warning('请先填写正确的官网地址（以 http 开头）'); return; }
    setFetchingUrl(true);
    try {
      const res = await knowledgeApi.extractUrl(website);
      if (res.data.ok && res.data.text) {
        setExtraText(prev => `[从官网提取]\n${res.data.text}\n\n${prev}`);
        antdMessage.success(`已从官网提取 ${res.data.length} 字内容`);
      } else {
        antdMessage.warning(res.data.error || '网页内容提取失败，请手动填写');
      }
    } catch {
      antdMessage.error('无法访问该网址，请手动填写公司资料');
    } finally {
      setFetchingUrl(false);
    }
  };

  const addContact = () => {
    const used = new Set(contacts.map(c => c.type));
    const next = CONTACT_TYPES.find(t => !used.has(t.value));
    if (next) setContacts([...contacts, { type: next.value, value: '' }]);
  };

  const buildRawText = (values: any) => {
    const hrs = `${hoursFrom} 至 ${hoursTo}，${timeFrom} - ${timeTo}`;
    const contactStr = contacts.filter(c => c.value).map(c => `${c.type}: ${c.value}`).join(' / ');
    const lines = [
      `公司名称：${values.companyName}`,
      `行业：${values.industry}`,
      `公司简介：${values.about}`,
      values.email ? `Email: ${values.email}` : '',
      values.website ? `官网: ${values.website}` : '',
      contactStr ? `联系方式：${contactStr}` : '',
      `营业时间：${hrs}`,
      extraText ? `\n补充资料：\n${extraText}` : '',
    ].filter(Boolean).join('\n');
    return lines;
  };

  const handleGenerate = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    if (!values.about?.trim()) { antdMessage.warning('请填写公司简介'); return; }

    setGenerating(true);
    try {
      const rawText = buildRawText(values);
      const res = await knowledgeApi.generateProductProfile({
        productName: values.companyName,
        rawText,
      });
      // 用 overview 作为档案基础，加上联系方式
      const contactStr = contacts.filter(c => c.value).map(c => `• ${c.type}: ${c.value}`).join('\n');
      const profile = [
        res.data.overview || `我们是 ${values.companyName}，专注于${values.industry}领域。${values.about}`,
        '',
        contactStr ? `📞 联系方式：\n${contactStr}` : '',
        values.email ? `📧 Email: ${values.email}` : '',
        values.website ? `🌐 官网: ${values.website}` : '',
        `⏰ 营业时间：${hoursFrom} 至 ${hoursTo}，${timeFrom} - ${timeTo}`,
      ].filter(Boolean).join('\n');
      setGeneratedProfile(profile);
      setStep(1);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }

    setSaving(true);
    try {
      const dto = {
        name: `${values.companyName} - 公司资料`,
        type: 'company',
        description: JSON.stringify({
          companyName: values.companyName,
          industry: values.industry,
          about: values.about,
          email: values.email,
          website: values.website,
          contacts,
          hoursFrom, hoursTo, timeFrom, timeTo,
        }),
        goalPrompt: generatedProfile,
        tenantId,
        enabled: true,
        isDefault: true,
      };
      if (existingKbId) {
        await knowledgeApi.updateKb(existingKbId, dto);
      } else {
        const res = await knowledgeApi.createKb(dto);
        setExistingKbId(res.data.id);
      }
      antdMessage.success('公司资讯已保存，Bot 立即可用 ✅');
      onClose();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <BankOutlined style={{ color: '#1677ff' }} />
          <span>设置公司资讯</span>
          {existingKbId && <Tag color="green">已有资料，可更新</Tag>}
        </Space>
      }
      width={700}
      centered
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', padding: '16px 24px' } }}
      footer={
        step === 0 ? [
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button key="gen" type="primary" icon={<RobotOutlined />}
            onClick={handleGenerate} loading={generating}>
            AI 生成档案预览
          </Button>,
        ] : [
          <Button key="back" onClick={() => setStep(0)}>← 返回修改</Button>,
          <Button key="save" type="primary" icon={<CheckCircleOutlined />}
            onClick={handleSave} loading={saving}>
            确认保存
          </Button>,
        ]
      }
    >
      <Steps current={step} size="small" style={{ marginBottom: 20 }}
        items={[{ title: '填写公司信息' }, { title: '确认 AI 档案' }]}
      />

      {step === 0 && (
        <Form form={form} layout="vertical">
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message="填写后 AI 会自动整理成结构化档案，Bot 用来回答「你们是哪家公司？」「怎么联系？」等问题" />

          {/* 公司名 + 行业 */}
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="例如：StarBright Solutions Sdn Bhd" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="industry" label="行业类别" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="选择行业" options={INDUSTRY_OPTIONS.map(v => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
          </Row>

          {/* Email + 官网 */}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="email" label="Email">
                <Input prefix="📧" placeholder="hello@company.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="website" label="官网" extra={
                <Button size="small" type="link" icon={<GlobalOutlined />}
                  onClick={handleFetchUrl} loading={fetchingUrl} style={{ padding: 0 }}>
                  从网站自动提取资讯
                </Button>
              }>
                <Input prefix="🌐" placeholder="https://yoursite.com" />
              </Form.Item>
            </Col>
          </Row>

          {/* 公司简介 */}
          <Form.Item name="about" label="公司简介" rules={[{ required: true, message: '必填' }]}
            extra="2-3 句话：做什么 / 服务谁 / 核心优势">
            <TextArea autoSize={{ minRows: 3, maxRows: 5 }}
              placeholder="例如：我们是一家专注于 SaaS 自动化的科技公司，为中小企业提供 Telegram 客服 + 广告投放一体化解决方案，帮助团队减少人工、提升转化率。" />
          </Form.Item>

          {/* 联系方式 */}
          <Form.Item label={
            <Space>
              <span>联系方式</span>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>（填越多越好）</Text>
            </Space>
          }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contacts.map((c, i) => (
                <Row key={i} gutter={8} align="middle">
                  <Col flex="120px">
                    <Select value={c.type} size="small" style={{ width: '100%' }}
                      onChange={(v) => {
                        const next = [...contacts]; next[i] = { ...next[i], type: v }; setContacts(next);
                      }}>
                      {CONTACT_TYPES.map(t => <Option key={t.value} value={t.value}>{t.label}</Option>)}
                    </Select>
                  </Col>
                  <Col flex="auto">
                    <Input size="small"
                      value={c.value}
                      placeholder={CONTACT_TYPES.find(t => t.value === c.type)?.placeholder ?? ''}
                      onChange={(e) => {
                        const next = [...contacts]; next[i] = { ...next[i], value: e.target.value }; setContacts(next);
                      }}
                    />
                  </Col>
                  <Col flex="32px">
                    {contacts.length > 1 && (
                      <Button size="small" danger icon={<DeleteOutlined />}
                        onClick={() => setContacts(contacts.filter((_, j) => j !== i))} />
                    )}
                  </Col>
                </Row>
              ))}
              {contacts.length < CONTACT_TYPES.length && (
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addContact} style={{ width: 140 }}>
                  添加联系方式
                </Button>
              )}
            </div>
          </Form.Item>

          {/* 营业时间 */}
          <Form.Item label="营业时间">
            <Row gutter={8} align="middle">
              <Col flex="auto">
                <Select value={hoursFrom} onChange={setHoursFrom} size="small" style={{ width: '100%' }}>
                  {DAYS.map(d => <Option key={d} value={d}>{d}</Option>)}
                </Select>
              </Col>
              <Col flex="20px" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>至</Text>
              </Col>
              <Col flex="auto">
                <Select value={hoursTo} onChange={setHoursTo} size="small" style={{ width: '100%' }}>
                  {DAYS.map(d => <Option key={d} value={d}>{d}</Option>)}
                </Select>
              </Col>
              <Col flex="16px" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}> </Text>
              </Col>
              <Col flex="auto">
                <Select value={timeFrom} onChange={setTimeFrom} size="small" style={{ width: '100%' }}>
                  {TIMES.map(t => <Option key={t} value={t}>{t}</Option>)}
                </Select>
              </Col>
              <Col flex="20px" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
              </Col>
              <Col flex="auto">
                <Select value={timeTo} onChange={setTimeTo} size="small" style={{ width: '100%' }}>
                  {TIMES.map(t => <Option key={t} value={t}>{t}</Option>)}
                </Select>
              </Col>
            </Row>
          </Form.Item>

          {/* 上传公司介绍书 */}
          <Divider style={{ margin: '12px 0' }} />
          <Form.Item label={
            <Space>
              <UploadOutlined />
              <span>公司介绍书（可选）</span>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>支持 PDF / Word / TXT</Text>
            </Space>
          } extra="上传后 AI 会从介绍书里额外提取资讯，让通用 FAQ 更准确">
            <Upload.Dragger
              accept=".pdf,.doc,.docx,.txt"
              multiple={false}
              showUploadList={false}
              style={{ padding: '8px 0' }}
              beforeUpload={async (file) => {
                try {
                  // 临时 KB 上传提取文字
                  const kbRes = await knowledgeApi.createKb({
                    name: `_tmp_company_upload`,
                    type: 'company',
                    tenantId,
                    enabled: false,
                  });
                  const tmpId = kbRes.data.id;
                  antdMessage.loading({ content: '正在解析文件...', key: 'up' });
                  const srcRes = await knowledgeApi.uploadSource(tmpId, file);
                  const txt = srcRes.data?.rawText ?? '';
                  if (txt) {
                    setExtraText(`[从介绍书提取]\n${txt}`);
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
                <p style={{ color: '#52c41a' }}>✅ 已上传：{uploadedFileName}</p>
              ) : (
                <p>点击或拖拽介绍书至此处</p>
              )}
            </Upload.Dragger>
          </Form.Item>

          {generating && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: '#1677ff' }}>
              <Spin /> <span style={{ marginLeft: 8 }}>AI 正在整理公司档案...</span>
            </div>
          )}
        </Form>
      )}

      {step === 1 && (
        <>
          <Alert type="success" showIcon style={{ marginBottom: 16 }}
            message="AI 已生成公司档案。你可以直接编辑内容，满意后点「确认保存」。" />
          <div style={{ marginBottom: 8 }}>
            <Text strong><EditOutlined style={{ marginRight: 4 }} />公司档案（Bot 用于回答公司相关问题）</Text>
          </div>
          <TextArea
            value={generatedProfile}
            onChange={(e) => setGeneratedProfile(e.target.value)}
            autoSize={{ minRows: 8, maxRows: 24 }}
            style={{ fontFamily: 'inherit' }}
          />
          <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>
            💡 Bot 收到「你们是哪家公司？」「怎么联系？」「几点营业？」时，会基于此档案自然回答
          </div>
        </>
      )}
    </Modal>
  );
}
