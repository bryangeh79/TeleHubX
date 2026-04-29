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
        antdMessage.error(err?.response?.data?.message ?? 'Failed to load campaign');
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
        antdMessage.success('Campaign updated');
      } else {
        await campaignsApi.create(payload);
        antdMessage.success('Campaign created');
      }
      navigate('/campaigns');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        {isEdit ? 'Edit Campaign' : 'New Campaign'}
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
        <Card title="Basic Info" style={{ marginBottom: 16 }} loading={loading}>
          <Form.Item
            name="name"
            label="Campaign Name"
            rules={[{ required: true, message: 'Required' }]}
          >
            <Input placeholder="e.g. April Property Leads" maxLength={80} />
          </Form.Item>

          <Form.Item name="description" label="Description (optional)">
            <TextArea rows={2} maxLength={300} showCount />
          </Form.Item>

          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true }]}
            extra="broadcast = same content to all targets in parallel; sequential = one target at a time"
          >
            <Select
              options={[
                { value: 'broadcast',  label: 'Broadcast' },
                { value: 'sequential', label: 'Sequential' },
              ]}
            />
          </Form.Item>
        </Card>

        <Card title="Targeting" style={{ marginBottom: 16 }}>
          <Form.Item
            name="accountIds"
            label="AD Accounts (UI-only for now)"
            extra="These come from the slot pool (ad/hybrid roles). Backend campaign↔account binding is not yet wired — selecting here is recorded for future."
          >
            <Select
              mode="multiple"
              placeholder={accounts.length ? 'Select AD accounts' : 'No ad/hybrid accounts bound yet'}
              options={accounts}
              disabled={accounts.length === 0}
            />
          </Form.Item>

          <Form.Item
            name="targets"
            label={
              <Space>
                Targets (Telegram usernames / chat IDs / invite links)
                <Tooltip title="One per entry. For groups: account must be a member.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: 'Add at least one target' }]}
          >
            <Select
              mode="tags"
              placeholder="@username, t.me/groupname, +60123..."
              tokenSeparators={[',', '\n']}
            />
          </Form.Item>
        </Card>

        <Card title="Message Variants" style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            Add multiple variants (different phrasing, emoji, formatting). The system rotates per account per target.
            Best practice: similarity {'<'} 70% across variants.
          </Text>

          <Form.List
            name="variants"
            rules={[
              {
                validator: async (_, variants) => {
                  if (!variants || variants.length < 1) {
                    return Promise.reject(new Error('At least one variant required'));
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, index) => (
                  <div key={field.key} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: 500 }}>Variant {index + 1}</Text>
                    <Space align="start" style={{ width: '100%', marginTop: 4 }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'text']}
                        noStyle
                        rules={[{ required: true, message: 'Variant text required' }]}
                      >
                        <TextArea
                          rows={3}
                          placeholder="Message text..."
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
                  Add Variant
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
        </Card>

        <Card title="Send Schedule (UI-only stub)" style={{ marginBottom: 24 }}>
          <Alert
            type="warning"
            showIcon
            message="Per-account daily limit & Gaussian interval are recorded in this form but not yet enforced server-side."
            description="Backend campaign executor will pick these up once the dispatch worker lands."
            style={{ marginBottom: 16, fontSize: 12 }}
          />
          <Form.Item
            name="dailyLimit"
            label={
              <Space>
                Daily Limit per Account
                <Tooltip title="Default cap: 10 msgs/account/day for ad accounts.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={50} style={{ width: 120 }} addonAfter="msgs/day" />
          </Form.Item>

          <Divider plain style={{ fontSize: 12, color: '#999' }}>Gaussian interval</Divider>

          <Space>
            <Form.Item name="intervalMinMin" label="Min" rules={[{ required: true }]}>
              <InputNumber min={1} max={240} style={{ width: 110 }} addonAfter="min" />
            </Form.Item>
            <Form.Item name="intervalMinMax" label="Max" rules={[{ required: true }]}>
              <InputNumber min={1} max={480} style={{ width: 110 }} addonAfter="min" />
            </Form.Item>
          </Space>
        </Card>

        <Space>
          <Button onClick={() => navigate('/campaigns')}>Cancel</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Create Campaign'}
          </Button>
        </Space>
      </Form>
    </div>
  );
}
