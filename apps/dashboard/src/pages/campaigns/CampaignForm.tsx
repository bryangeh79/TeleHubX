import { useState } from 'react';
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
  message,
  Tooltip,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { campaignsApi } from '../../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

const MOCK_ACCOUNTS = [
  { value: 'acc-1', label: '+60123456789 (AD)' },
  { value: 'acc-2', label: '+60177654321 (AD)' },
  { value: 'acc-3', label: '+60198765432 (AD)' },
];

interface CampaignFormValues {
  name: string;
  description?: string;
  accountIds: string[];
  targetGroups: string[];
  variants: { text: string }[];
  dailyLimit: number;
  intervalMinMin: number;
  intervalMinMax: number;
}

export default function CampaignForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const [form] = Form.useForm<CampaignFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    let values: CampaignFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && id) {
        await campaignsApi.update(id, values);
        message.success('Campaign updated');
      } else {
        await campaignsApi.create(values);
        message.success('Campaign created');
      }
      navigate('/campaigns');
    } catch {
      message.success(isEdit ? 'Campaign updated (mock)' : 'Campaign created (mock)');
      navigate('/campaigns');
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
          dailyLimit: 10,
          intervalMinMin: 30,
          intervalMinMax: 90,
          variants: [{ text: '' }],
          targetGroups: [],
          accountIds: [],
        }}
      >
        <Card title="Basic Info" style={{ marginBottom: 16 }}>
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
        </Card>

        <Card title="Targeting" style={{ marginBottom: 16 }}>
          <Form.Item
            name="accountIds"
            label="AD Accounts"
            rules={[{ required: true, message: 'Select at least one AD account' }]}
          >
            <Select
              mode="multiple"
              placeholder="Select AD accounts"
              options={MOCK_ACCOUNTS}
            />
          </Form.Item>

          <Form.Item
            name="targetGroups"
            label={
              <Space>
                Target Groups (Telegram usernames / invite links)
                <Tooltip title="One group per entry. Account must already be a member.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: 'Add at least one group' }]}
          >
            <Select
              mode="tags"
              placeholder="@groupusername or t.me/..."
              tokenSeparators={[',', '\n']}
            />
          </Form.Item>
        </Card>

        <Card title="Message Variants" style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            Add multiple variants (different phrasing, emoji, formatting). Similarity must be &lt;70%.
            The system rotates variants per account per group.
          </Text>

          <Form.List
            name="variants"
            rules={[
              {
                validator: async (_, variants) => {
                  if (!variants || variants.length < 1) {
                    return Promise.reject('At least one variant required');
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, index) => (
                  <Form.Item
                    key={field.key}
                    label={`Variant ${index + 1}`}
                    required
                  >
                    <Space align="start" style={{ width: '100%' }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'text']}
                        noStyle
                        rules={[{ required: true, message: 'Variant text required' }]}
                      >
                        <TextArea
                          rows={3}
                          placeholder="Message text for this variant..."
                          maxLength={1000}
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
                  </Form.Item>
                ))}

                <Form.Item>
                  <Button
                    type="dashed"
                    onClick={() => add()}
                    icon={<PlusOutlined />}
                    style={{ width: '100%' }}
                  >
                    Add Variant
                  </Button>
                  <Form.ErrorList errors={errors} />
                </Form.Item>
              </>
            )}
          </Form.List>
        </Card>

        <Card title="Send Schedule" style={{ marginBottom: 24 }}>
          <Form.Item
            name="dailyLimit"
            label={
              <Space>
                Daily Limit per Account
                <Tooltip title="TeleHubX enforces max 10 msgs/account/day for AD accounts by default.">
                  <InfoCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={10} style={{ width: 120 }} addonAfter="msgs/day" />
          </Form.Item>

          <Divider plain style={{ fontSize: 12, color: '#999' }}>Gaussian interval (minutes)</Divider>

          <Space>
            <Form.Item name="intervalMinMin" label="Min interval" rules={[{ required: true }]}>
              <InputNumber min={5} max={120} style={{ width: 110 }} addonAfter="min" />
            </Form.Item>
            <Form.Item name="intervalMinMax" label="Max interval" rules={[{ required: true }]}>
              <InputNumber min={5} max={240} style={{ width: 110 }} addonAfter="min" />
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
