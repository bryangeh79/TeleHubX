import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Space,
  Card,
  Typography,
  Select,
  InputNumber,
  Divider,
  Tooltip,
  Alert,
  message as antdMessage,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { campaignsApi, slotsApi } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

type CampaignType = 'broadcast' | 'sequential';

interface AccountOption {
  value: string;
  label: string;
}

interface FormValues {
  name: string;
  description?: string;
  type: CampaignType;
  accountIds: string[]; // UI-only — not sent to backend yet (backend has no campaign↔account FK)
  targets: string[];
  variants: Array<{ text: string; mediaUrl?: string }>;
  dailyLimit: number;        // UI-only display
  intervalMinMin: number;    // UI-only display
  intervalMinMax: number;    // UI-only display
  scheduledAt?: string;
}

export default function CampaignForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch ad/hybrid accounts for the selector
  useEffect(() => {
    void (async () => {
      try {
        const res = await slotsApi.list();
        const slots = Array.isArray(res.data) ? res.data : [];
        const opts: AccountOption[] = slots
          .filter((s: any) => s.account && (s.account.role === 'ad' || s.account.role === 'hybrid'))
          .map((s: any) => ({
            value: s.account.id,
            label: `No.${String(s.no).padStart(2, '0')} · ${s.account.phoneNumber} (${s.account.role})`,
          }));
        setAccounts(opts);
      } catch {
        setAccounts([]);
      }
    })();
  }, []);

  // Load existing campaign in edit mode
  useEffect(() => {
    if (!isEdit || !id) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await campaignsApi.get(id);
        const c = res.data;
        form.setFieldsValue({
          name: c.name,
          description: c.description ?? '',
          type: c.type ?? 'broadcast',
          accountIds: [],
          targets: c.targets ?? [],
          variants: (c.messageVariants ?? []).map((v: any) => ({ text: v.text, mediaUrl: v.mediaUrl })),
          dailyLimit: 10,
          intervalMinMin: 30,
          intervalMinMax: 90,
        });
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, id, form]);

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        type: values.type,
        targets: values.targets,
        messageVariants: values.variants.map((v) => ({
          text: v.text,
          ...(v.mediaUrl ? { mediaUrl: v.mediaUrl } : {}),
        })),
      };
      if (isEdit && id) {
        await campaignsApi.update(id, payload);
        antdMessage.success('已更新');
      } else {
        await campaignsApi.create(payload);
        antdMessage.success('已创建');
      }
      navigate('/campaigns');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        {isEdit ? '编辑广告' : '新建广告'}
      </Title>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: 'broadcast',
          dailyLimit: 10,
          intervalMinMin: 30,
          intervalMinMax: 90,
          variants: [{ text: '' }],
          targets: [],
          accountIds: [],
        }}
      >
        <Card title="基本信息" style={{ marginBottom: 16 }} loading={loading}>
          <Form.Item
            name="name"
            label="广告名称"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="例: 4 月房产线索" maxLength={80} />
          </Form.Item>

          <Form.Item name="description" label="备注 (选填)">
            <TextArea rows={2} maxLength={300} showCount />
          </Form.Item>

          <Form.Item
            name="type"
            label="发送方式"
            rules={[{ required: true }]}
            extra="群发 = 同样内容并行发给所有目标; 顺序 = 一个一个发"
          >
            <Select
              options={[
                { value: 'broadcast',  label: '群发 (并行)' },
                { value: 'sequential', label: '顺序 (一个一个发)' },
              ]}
            />
          </Form.Item>
        </Card>

        <Card title="目标与发送号" style={{ marginBottom: 16 }}>
          <Form.Item
            name="accountIds"
            label="广告号 (暂仅 UI 记录)"
            extra="来自账号槽位池 (ad / hybrid 角色). 后端 campaign↔account 绑定还没接通, 现阶段选了仅记录, 实际不影响发送."
          >
            <Select
              mode="multiple"
              placeholder={accounts.length ? '选择广告号' : '还没绑定 ad / hybrid 账号'}
              options={accounts}
              disabled={accounts.length === 0}
            />
          </Form.Item>

          <Form.Item
            name="targets"
            label={
              <Space>
                目标 (TG 用户名 / 群 ID / 邀请链接)
                <Tooltip title="一行一个. 群目标: 发送号必须已加入该群.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: '至少填一个目标' }]}
          >
            <Select
              mode="tags"
              placeholder="@username, t.me/groupname, +60123..."
              tokenSeparators={[',', '\n']}
            />
          </Form.Item>
        </Card>

        <Card title="文案变体" style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            建议加多版本变体 (用词 / emoji / 排版微差异). 系统会在每号每目标间轮换. 最佳实践: 变体相互相似度 {'<'} 70%.
          </Text>

          <Form.List
            name="variants"
            rules={[
              {
                validator: async (_, variants) => {
                  if (!variants || variants.length < 1) {
                    return Promise.reject(new Error('至少填一条变体'));
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, index) => (
                  <div key={field.key} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: 500 }}>变体 {index + 1}</Text>
                    <Space align="start" style={{ width: '100%', marginTop: 4 }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'text']}
                        noStyle
                        rules={[{ required: true, message: '变体文案不能为空' }]}
                      >
                        <TextArea
                          rows={3}
                          placeholder="消息文案..."
                          maxLength={4000}
                          showCount
                          style={{ width: 560 }}
                        />
                      </Form.Item>
                      {fields.length > 1 && (
                        <MinusCircleOutlined
                          onClick={() => remove(field.name)}
                          style={{ color: '#ff4d4f', marginTop: 8, fontSize: 18, cursor: 'pointer' }}
                        />
                      )}
                    </Space>
                  </div>
                ))}

                <Button
                  type="dashed"
                  onClick={() => add({ text: '' })}
                  icon={<PlusOutlined />}
                  style={{ width: '100%' }}
                >
                  新增变体
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
        </Card>

        <Card title="发送节奏 (UI 占位)" style={{ marginBottom: 24 }}>
          <Alert
            type="warning"
            showIcon
            message="每号每日上限 + 高斯随机间隔目前只是表单记录, 服务端还没强制执行."
            description="等 dispatch worker 落地后, 后端会读取这两项作真节奏控制."
            style={{ marginBottom: 16, fontSize: 12 }}
          />
          <Form.Item
            name="dailyLimit"
            label={
              <Space>
                每号每日上限
                <Tooltip title="广告号默认: 10 条/号/天.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={50} style={{ width: 130 }} addonAfter="条/天" />
          </Form.Item>

          <Divider plain style={{ fontSize: 12, color: '#999' }}>高斯随机间隔</Divider>

          <Space>
            <Form.Item name="intervalMinMin" label="最小" rules={[{ required: true }]}>
              <InputNumber min={1} max={240} style={{ width: 110 }} addonAfter="分钟" />
            </Form.Item>
            <Form.Item name="intervalMinMax" label="最大" rules={[{ required: true }]}>
              <InputNumber min={1} max={480} style={{ width: 110 }} addonAfter="分钟" />
            </Form.Item>
          </Space>
        </Card>

        <Space>
          <Button onClick={() => navigate('/campaigns')}>取消</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? '保存修改' : '创建广告'}
          </Button>
        </Space>
      </Form>
    </div>
  );
}
