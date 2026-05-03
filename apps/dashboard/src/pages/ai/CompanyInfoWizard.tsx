import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Form, Input, Modal, Row, Select,
  Space, Spin, Steps, Tag, Typography, message as antdMessage,
} from 'antd';
import { BankOutlined, CheckCircleOutlined, EditOutlined, RobotOutlined } from '@ant-design/icons';
import { knowledgeApi, platformConfigApi } from '../../services/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

interface FormData {
  companyName: string;
  industry: string;
  about: string;
  whatsapp?: string;
  telegram?: string;
  email?: string;
  website?: string;
  hours?: string;
  languages?: string;
}

const INDUSTRY_OPTIONS = [
  'SaaS / 软件服务', '电商 / 零售', '教育 / 培训', '金融 / 保险',
  '餐饮 / 食品', '医疗 / 健康', '房地产', '制造业', '咨询 / 服务', '其他',
];

const LANGUAGE_OPTIONS = ['中文', '英文', '马来文', '粤语', '越南语', '印尼语'];

export default function CompanyInfoWizard({ open, onClose, tenantId }: Props) {
  const [step, setStep] = useState(0);
  const [form] = Form.useForm<FormData>();
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedProfile, setGeneratedProfile] = useState('');
  const [existingKbId, setExistingKbId] = useState<string | null>(null);

  // 加载已有公司资料
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setGeneratedProfile('');
    knowledgeApi.listKbs({ type: 'company' }).then((res) => {
      const existing = (res.data ?? []).find((kb: any) => !tenantId || kb.tenantId === tenantId);
      if (existing) {
        setExistingKbId(existing.id);
        // 还原表单（description 存 JSON 化的公司资料）
        try {
          const saved = JSON.parse(existing.description ?? '{}');
          form.setFieldsValue(saved);
        } catch {}
        setGeneratedProfile(existing.goalPrompt ?? '');
      }
    }).catch(() => {});
  }, [open]);

  const handleGenerate = async () => {
    let values: FormData;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setGenerating(true);
    try {
      // 用平台 AI 把结构化信息整理成一段自然语言档案
      const contactParts: string[] = [];
      if (values.whatsapp) contactParts.push(`WhatsApp: ${values.whatsapp}`);
      if (values.telegram) contactParts.push(`Telegram: ${values.telegram}`);
      if (values.email) contactParts.push(`Email: ${values.email}`);
      if (values.website) contactParts.push(`网站: ${values.website}`);

      const raw = [
        `公司名称：${values.companyName}`,
        `行业：${values.industry}`,
        `公司简介：${values.about}`,
        contactParts.length ? `联系方式：${contactParts.join(' / ')}` : '',
        values.hours ? `营业时间：${values.hours}` : '',
        values.languages ? `支持语言：${values.languages}` : '',
      ].filter(Boolean).join('\n');

      // 调用产品档案生成，传入公司资料当 rawText
      const res = await knowledgeApi.generateProductProfile({
        productName: values.companyName,
        rawText: raw,
      });
      setGeneratedProfile(res.data.overview || raw);
      setStep(1);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'AI 生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    let values: FormData;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      const dto = {
        name: `${values.companyName} - 公司资料`,
        type: 'company',
        description: JSON.stringify(values),
        goalPrompt: generatedProfile,
        tenantId,
        enabled: true,
        isDefault: true,
      };

      if (existingKbId) {
        await knowledgeApi.updateKb(existingKbId, dto);
      } else {
        await knowledgeApi.createKb(dto);
      }
      antdMessage.success('公司资讯已保存，Bot 将立即使用此资料回答客户');
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
      width={680}
      centered
      footer={
        step === 0 ? [
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button key="gen" type="primary" icon={<RobotOutlined />}
            onClick={handleGenerate} loading={generating}>
            AI 生成档案预览
          </Button>,
        ] : [
          <Button key="back" onClick={() => setStep(0)}>返回修改</Button>,
          <Button key="save" type="primary" icon={<CheckCircleOutlined />}
            onClick={handleSave} loading={saving}>
            确认保存
          </Button>,
        ]
      }
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: '填写公司信息' },
          { title: '确认 AI 档案' },
        ]}
      />

      {step === 0 && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="填写后 AI 会自动整理成结构化档案，Bot 用来回答「你们是哪家公司？」「怎么联系？」等问题"
          />
          <Form form={form} layout="vertical">
            <Row gutter={12}>
              <Col span={14}>
                <Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="例如：TeleHubX Malaysia Sdn Bhd" />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="industry" label="行业类别" rules={[{ required: true, message: '必填' }]}>
                  <Select placeholder="选择行业" options={INDUSTRY_OPTIONS.map(v => ({ value: v, label: v }))} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="about" label="公司简介" rules={[{ required: true, message: '必填' }]}
              extra="2-3 句话：我们做什么 / 服务谁 / 核心优势">
              <TextArea autoSize={{ minRows: 3, maxRows: 5 }}
                placeholder="例如：我们是一家专注于 SaaS 自动化的科技公司，为中小企业提供 Telegram 客服 + 广告投放一体化解决方案，帮助团队减少人工、提升转化率。" />
            </Form.Item>

            <Card size="small" style={{ marginBottom: 12, background: '#f9f9f9' }} title="联系方式（填越多越好）">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="whatsapp" label="WhatsApp" style={{ marginBottom: 8 }}>
                    <Input placeholder="https://wa.me/601234..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="telegram" label="Telegram" style={{ marginBottom: 8 }}>
                    <Input placeholder="@YourTelegramBot" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="email" label="Email" style={{ marginBottom: 8 }}>
                    <Input placeholder="hello@company.com" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="website" label="官网" style={{ marginBottom: 8 }}>
                    <Input placeholder="https://yoursite.com" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="hours" label="营业时间">
                  <Input placeholder="例如：周一至五 9am-6pm MYT" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="languages" label="支持语言">
                  <Select mode="multiple" placeholder="选择支持语言"
                    options={LANGUAGE_OPTIONS.map(v => ({ value: v, label: v }))} />
                </Form.Item>
              </Col>
            </Row>
          </Form>
          {generating && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#1677ff' }}>
              <Spin /> <span style={{ marginLeft: 8 }}>AI 正在整理公司档案...</span>
            </div>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <Alert type="success" showIcon style={{ marginBottom: 16 }}
            message="AI 已生成公司档案预览。你可以直接编辑内容，满意后点「确认保存」。" />
          <div style={{ marginBottom: 8 }}>
            <Text strong><EditOutlined style={{ marginRight: 4 }} />公司档案（Bot 用于回答公司相关问题）</Text>
          </div>
          <TextArea
            value={generatedProfile}
            onChange={(e) => setGeneratedProfile(e.target.value)}
            autoSize={{ minRows: 6, maxRows: 20 }}
            style={{ fontFamily: 'inherit' }}
          />
          <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
            💡 Bot 收到「你们是哪家公司？」「怎么联系你们？」时，会基于此档案自然回答
          </div>
        </>
      )}
    </Modal>
  );
}
