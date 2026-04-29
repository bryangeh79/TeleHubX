import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Steps,
  Form,
  Input,
  Button,
  Space,
  Card,
  Typography,
  Descriptions,
  Radio,
  message,
} from 'antd';
import { accountsApi } from '../../services/api';

const { Title, Text } = Typography;

type Role = 'cs' | 'ad' | 'hybrid';

const ROLE_META: Record<Role, { label: string; desc: string }> = {
  cs:     { label: 'CS — Customer Service',  desc: 'AI auto-reply + FAQ + human takeover. Passive inbound only. Single Bot entry point.' },
  ad:     { label: 'AD — Advertiser',        desc: 'Campaign broadcast, group ChatScript, Warmup P0-P4. No AI reply. Max 10 msgs/day.' },
  hybrid: { label: 'Hybrid',                 desc: 'High-risk mode. Requires Super Admin explicit override to activate.' },
};

interface Step1Values {
  phone: string;
  proxyHost: string;
  proxyPort: string;
  proxyUser?: string;
  proxyPass?: string;
}

interface Step2Values {
  role: Role;
}

export default function BindWizard() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [form1] = Form.useForm<Step1Values>();
  const [form2] = Form.useForm<Step2Values>();
  const [step1, setStep1] = useState<Step1Values | null>(null);
  const [step2, setStep2] = useState<Step2Values | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleStep1Next = async () => {
    const values = await form1.validateFields();
    setStep1(values);
    setCurrent(1);
  };

  const handleStep2Next = async () => {
    const values = await form2.validateFields();
    setStep2(values);
    setCurrent(2);
  };

  const handleSubmit = async () => {
    if (!step1 || !step2) return;
    setSubmitting(true);
    try {
      await accountsApi.create({
        phone: step1.phone,
        proxy: {
          host: step1.proxyHost,
          port: Number(step1.proxyPort),
          username: step1.proxyUser || undefined,
          password: step1.proxyPass || undefined,
        },
        role: step2.role,
      });
      message.success('Account created. OTP verification will begin shortly.');
      navigate('/accounts');
    } catch {
      message.error('Failed to create account. Check server connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Bind New Account</Title>

      <Steps
        current={current}
        items={[
          { title: 'Phone & Proxy' },
          { title: 'Role' },
          { title: 'Confirm' },
        ]}
        style={{ marginBottom: 32 }}
      />

      {current === 0 && (
        <Card>
          <Form form={form1} layout="vertical" requiredMark="optional">
            <Form.Item
              name="phone"
              label="Phone Number"
              rules={[
                { required: true, message: 'Required' },
                { pattern: /^\+\d{8,15}$/, message: 'E.164 format required, e.g. +60123456789' },
              ]}
            >
              <Input placeholder="+60123456789" maxLength={16} />
            </Form.Item>

            <Form.Item label="SOCKS5 Proxy" required style={{ marginBottom: 0 }}>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  name="proxyHost"
                  noStyle
                  rules={[{ required: true, message: 'Host required' }]}
                >
                  <Input placeholder="host (e.g. 1.2.3.4)" style={{ flex: 1 }} />
                </Form.Item>
                <Form.Item
                  name="proxyPort"
                  noStyle
                  rules={[
                    { required: true, message: 'Port required' },
                    { pattern: /^\d{2,5}$/, message: 'Invalid port' },
                  ]}
                >
                  <Input placeholder="1080" style={{ width: 90 }} />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
              One account = one fixed residential/mobile IP. Never rotate.
            </Text>

            <Form.Item name="proxyUser" label="Proxy Username">
              <Input placeholder="optional" autoComplete="off" />
            </Form.Item>
            <Form.Item name="proxyPass" label="Proxy Password">
              <Input.Password placeholder="optional" autoComplete="new-password" />
            </Form.Item>
          </Form>

          <Space>
            <Button onClick={() => navigate('/accounts')}>Cancel</Button>
            <Button type="primary" onClick={handleStep1Next}>Next</Button>
          </Space>
        </Card>
      )}

      {current === 1 && (
        <Card>
          <Form form={form2} layout="vertical">
            <Form.Item
              name="role"
              label="Account Role"
              rules={[{ required: true, message: 'Select a role' }]}
            >
              <Radio.Group style={{ width: '100%' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {(['cs', 'ad', 'hybrid'] as Role[]).map(role => (
                    <Radio
                      key={role}
                      value={role}
                      style={{
                        width: '100%',
                        border: '1px solid #d9d9d9',
                        borderRadius: 8,
                        padding: '12px 16px',
                        marginInlineEnd: 0,
                      }}
                    >
                      <Text strong>{ROLE_META[role].label}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {ROLE_META[role].desc}
                      </Text>
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Form.Item>
          </Form>

          <Space>
            <Button onClick={() => setCurrent(0)}>Back</Button>
            <Button type="primary" onClick={handleStep2Next}>Next</Button>
          </Space>
        </Card>
      )}

      {current === 2 && step1 && step2 && (
        <Card>
          <Descriptions title="Confirm Details" bordered column={1} style={{ marginBottom: 24 }}>
            <Descriptions.Item label="Phone">{step1.phone}</Descriptions.Item>
            <Descriptions.Item label="Proxy">
              {step1.proxyHost}:{step1.proxyPort}
              {step1.proxyUser ? ` (user: ${step1.proxyUser})` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Role">
              {ROLE_META[step2.role].label}
            </Descriptions.Item>
          </Descriptions>

          <Space>
            <Button onClick={() => setCurrent(1)}>Back</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Submit
            </Button>
          </Space>
        </Card>
      )}
    </div>
  );
}
