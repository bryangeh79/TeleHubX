import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Space,
  Result,
  Descriptions,
  Tag,
  Spin,
  message as antdMessage,
} from 'antd';
import { KeyOutlined, CheckCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { licensesApi } from '../../services/api';

const { Title, Text } = Typography;

interface Status {
  activated: boolean;
  license?: {
    keyMasked: string;
    plan: string;
    status: string;
    expiresAt: string;
    activatedAt: string;
  };
  tenant?: {
    id: string;
    name: string;
    plan: string;
    maxAccounts: number;
  };
}

const PLAN_COLOR: Record<string, string> = {
  basic: 'default',
  pro: 'blue',
  enterprise: 'purple',
};

export default function ActivatePage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<{ key: string; tenantName?: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const reloadStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await licensesApi.status();
      setStatus(res.data);
    } catch {
      setStatus({ activated: false });
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void reloadStatus();
  }, []);

  const handleActivate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const res = await licensesApi.activate(values.key.trim(), values.tenantName?.trim());
      antdMessage.success(`Activated — plan: ${res.data.tenant.plan}, max ${res.data.tenant.maxAccounts} accounts`);
      await reloadStatus();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Activation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #722ed1 0%, #1677ff 100%)',
      padding: 24,
    }}>
      <Card style={{ width: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0, color: '#1677ff' }}>TeleHubX License Activation</Title>
          <Text type="secondary">Enter your license key to enable the platform</Text>
        </div>

        {loadingStatus ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : status?.activated && status.license && status.tenant ? (
          <>
            <Result
              status="success"
              icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              title="License Activated"
              subTitle="Your platform is ready"
              style={{ padding: 0 }}
            />
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Tenant">
                <Text strong>{status.tenant.name}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Plan">
                <Tag color={PLAN_COLOR[status.tenant.plan] ?? 'default'}>
                  {status.tenant.plan.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Max Accounts">{status.tenant.maxAccounts}</Descriptions.Item>
              <Descriptions.Item label="License Key">
                <Text code style={{ fontSize: 11 }}>{status.license.keyMasked}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Activated">
                {dayjs(status.license.activatedAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="Expires">
                {dayjs(status.license.expiresAt).format('YYYY-MM-DD')}
              </Descriptions.Item>
            </Descriptions>

            <Space style={{ width: '100%', justifyContent: 'center' }}>
              <Button type="primary" onClick={() => navigate('/login')}>
                Continue to Login
              </Button>
              <Button onClick={() => navigate('/')}>
                Skip to Dashboard
              </Button>
            </Space>
          </>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message="License key format"
              description={
                <>
                  <Text code>TLHX-{'{PLAN}'}-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX</Text> issued by the platform operator.
                  <br />
                  Contact your TeleHubX provider if you don't have a key. Dev tip: an admin can generate one
                  via <Text code>POST /api/v1/licenses/issue</Text>.
                </>
              }
              style={{ marginBottom: 16 }}
            />

            <Form form={form} layout="vertical" onFinish={handleActivate}>
              <Form.Item
                name="key"
                label="License Key"
                rules={[
                  { required: true, message: 'Required' },
                  { min: 20, message: 'Looks too short' },
                ]}
              >
                <Input
                  prefix={<KeyOutlined />}
                  placeholder="TLHX-PRO-..."
                  size="large"
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item
                name="tenantName"
                label="Tenant Name (optional — defaults to 'default')"
                extra="Leave blank for single-tenant mode."
              >
                <Input placeholder="default" />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={submitting} block size="large">
                Activate
              </Button>
            </Form>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button type="link" onClick={() => navigate('/login')}>
                Already activated? Log in
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
