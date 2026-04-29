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
  Alert,
  Result,
} from 'antd';
import { accountsApi } from '../../services/api';

const { Title, Text } = Typography;

type Role = 'cs' | 'ad' | 'hybrid';

const ROLE_META: Record<Role, { label: string; desc: string }> = {
  cs:     { label: 'CS — Customer Service',  desc: 'AI auto-reply + FAQ + human takeover. Passive inbound only.' },
  ad:     { label: 'AD — Advertiser',        desc: 'Campaign broadcast, group ChatScript, Warmup P0-P4. No AI reply.' },
  hybrid: { label: 'Hybrid',                 desc: 'High-risk mode. Requires Super Admin explicit override to activate.' },
};

interface SetupValues {
  phone: string;
  role: Role;
  proxyHost?: string;
  proxyPort?: string;
  proxyUser?: string;
  proxyPass?: string;
}

interface VerifyValues {
  code: string;
  password?: string;
}

interface BoundUser {
  id: string;
  username?: string;
  firstName?: string;
  phone?: string;
}

export default function BindWizard() {
  const navigate = useNavigate();

  const [current, setCurrent] = useState(0);
  const [setupForm] = Form.useForm<SetupValues>();
  const [verifyForm] = Form.useForm<VerifyValues>();

  // Carries data forward between steps
  const [accountId, setAccountId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string>('');
  const [needsPassword, setNeedsPassword] = useState<boolean>(false);
  const [twoFactorHint, setTwoFactorHint] = useState<string | undefined>();
  const [boundUser, setBoundUser] = useState<BoundUser | null>(null);

  // Loading states
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const extractMessage = (err: any, fallback: string): string => {
    const apiMsg = err?.response?.data?.message;
    if (Array.isArray(apiMsg)) return apiMsg.join('; ');
    if (typeof apiMsg === 'string') return apiMsg;
    return fallback;
  };

  /** Step 0 → 1: create account record + send Telegram OTP */
  const handleSendCode = async () => {
    let values: SetupValues;
    try {
      values = await setupForm.validateFields();
    } catch {
      return;
    }
    setSendingCode(true);
    let createdId: string | null = null;
    try {
      // Create the account record (carries phone/role/proxy)
      const createRes = await accountsApi.create({
        phoneNumber: values.phone,
        role: values.role,
        proxyConfig:
          values.proxyHost && values.proxyPort
            ? {
                host: values.proxyHost,
                port: Number(values.proxyPort),
                username: values.proxyUser || undefined,
                password: values.proxyPass || undefined,
              }
            : undefined,
      });
      createdId = createRes.data.id as string;

      // Trigger Telegram sendCode for that record
      const initRes = await accountsApi.bindInit(createdId, values.phone);
      const expiresIn = initRes.data?.expiresIn ?? 60;

      setAccountId(createdId);
      setPhone(values.phone);
      setNeedsPassword(false);
      setTwoFactorHint(undefined);
      verifyForm.resetFields();
      setCurrent(1);
      message.success(`OTP sent — expires in ${expiresIn}s. Check your Telegram app.`);
    } catch (err: any) {
      // If account was created but bind/init failed, roll back the account
      if (createdId) {
        await accountsApi.delete(createdId).catch(() => {});
      }
      message.error(extractMessage(err, 'Failed to send OTP'));
    } finally {
      setSendingCode(false);
    }
  };

  /** Step 1: verify OTP (and 2FA password if prompted) */
  const handleVerify = async () => {
    if (!accountId) return;
    let values: VerifyValues;
    try {
      values = await verifyForm.validateFields();
    } catch {
      return;
    }
    setVerifying(true);
    try {
      const res = await accountsApi.bindVerify(accountId, values.code, values.password);
      const data = res.data;

      if (data.needsPassword === true && data.ok === false) {
        // 2FA gate — keep on step 1, reveal password field
        setNeedsPassword(true);
        setTwoFactorHint(data.hint);
        message.info('2FA password required for this account');
        return;
      }

      if (data.ok === true) {
        setBoundUser(data.user);
        setCurrent(2);
        message.success(`Bound as ${data.user?.firstName ?? data.user?.username ?? 'user'}`);
      }
    } catch (err: any) {
      const msg = extractMessage(err, 'Verification failed');
      message.error(msg);
      // Verify endpoint cleans up active session on hard error → user must restart
      if (msg.includes('No active bind') || msg.includes('expired')) {
        setCurrent(0);
        setAccountId(null);
      }
    } finally {
      setVerifying(false);
    }
  };

  /** Cancel mid-flow: delete account + cancel any in-progress bind */
  const handleCancel = async () => {
    if (accountId) {
      await accountsApi.bindCancel(accountId).catch(() => {});
      await accountsApi.delete(accountId).catch(() => {});
    }
    navigate('/accounts');
  };

  /** Resend OTP from step 1 (e.g. expired) */
  const handleResend = async () => {
    if (!accountId || !phone) return;
    setSendingCode(true);
    try {
      const res = await accountsApi.bindInit(accountId, phone);
      const expiresIn = res.data?.expiresIn ?? 60;
      setNeedsPassword(false);
      verifyForm.resetFields(['code', 'password']);
      message.success(`New OTP sent — expires in ${expiresIn}s`);
    } catch (err: any) {
      message.error(extractMessage(err, 'Failed to resend OTP'));
    } finally {
      setSendingCode(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Bind Telegram Account</Title>

      <Steps
        current={current}
        items={[
          { title: 'Setup' },
          { title: 'Verify OTP' },
          { title: 'Done' },
        ]}
        style={{ marginBottom: 32 }}
      />

      {/* === STEP 0: Setup phone + role + proxy === */}
      {current === 0 && (
        <Card>
          <Form form={setupForm} layout="vertical" requiredMark="optional" initialValues={{ role: 'ad' }}>
            <Form.Item
              name="phone"
              label="Phone Number"
              extra="E.164 format with country code"
              rules={[
                { required: true, message: 'Required' },
                { pattern: /^\+\d{6,15}$/, message: 'E.164 required, e.g. +60123456789' },
              ]}
            >
              <Input placeholder="+60123456789" maxLength={16} />
            </Form.Item>

            <Form.Item
              name="role"
              label="Account Role"
              rules={[{ required: true, message: 'Select a role' }]}
            >
              <Radio.Group style={{ width: '100%' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {(['cs', 'ad', 'hybrid'] as Role[]).map((role) => (
                    <Radio
                      key={role}
                      value={role}
                      style={{
                        width: '100%',
                        border: '1px solid #d9d9d9',
                        borderRadius: 6,
                        padding: '10px 14px',
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

            <Form.Item label="SOCKS5 Proxy" extra="Optional. One account → one fixed IP, never rotate.">
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="proxyHost" noStyle>
                  <Input placeholder="host (e.g. 1.2.3.4)" style={{ flex: 1 }} />
                </Form.Item>
                <Form.Item
                  name="proxyPort"
                  noStyle
                  rules={[{ pattern: /^\d{2,5}$/, message: 'Invalid' }]}
                >
                  <Input placeholder="1080" style={{ width: 90 }} />
                </Form.Item>
              </Space.Compact>
            </Form.Item>

            <Form.Item name="proxyUser" label="Proxy Username">
              <Input placeholder="optional" autoComplete="off" />
            </Form.Item>
            <Form.Item name="proxyPass" label="Proxy Password">
              <Input.Password placeholder="optional" autoComplete="new-password" />
            </Form.Item>
          </Form>

          <Space>
            <Button onClick={() => navigate('/accounts')}>Cancel</Button>
            <Button type="primary" loading={sendingCode} onClick={handleSendCode}>
              Send OTP
            </Button>
          </Space>
        </Card>
      )}

      {/* === STEP 1: Enter OTP (and 2FA password if needed) === */}
      {current === 1 && (
        <Card>
          <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Phone">{phone}</Descriptions.Item>
            <Descriptions.Item label="Account ID">
              <Text code style={{ fontSize: 11 }}>{accountId}</Text>
            </Descriptions.Item>
          </Descriptions>

          <Alert
            type="info"
            message="Check your Telegram app for an official message containing the OTP code."
            description="If your phone has Telegram installed, the code arrives there (not as SMS). The official sender is the verified Telegram account."
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form form={verifyForm} layout="vertical">
            <Form.Item
              name="code"
              label="OTP Code"
              rules={[
                { required: true, message: 'Required' },
                { pattern: /^\d{4,8}$/, message: '4-8 digits' },
              ]}
            >
              <Input
                placeholder="12345"
                maxLength={8}
                autoFocus
                autoComplete="one-time-code"
              />
            </Form.Item>

            {needsPassword && (
              <>
                <Alert
                  type="warning"
                  message="2FA password required"
                  description={twoFactorHint ? `Hint: ${twoFactorHint}` : 'This account has two-factor authentication enabled.'}
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Form.Item
                  name="password"
                  label="2FA Password"
                  rules={[{ required: true, message: 'Required for 2FA accounts' }]}
                >
                  <Input.Password placeholder="cloud password" autoComplete="current-password" />
                </Form.Item>
              </>
            )}
          </Form>

          <Space>
            <Button onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleResend} loading={sendingCode} disabled={verifying}>
              Resend OTP
            </Button>
            <Button type="primary" loading={verifying} onClick={handleVerify}>
              {needsPassword ? 'Verify with 2FA' : 'Verify'}
            </Button>
          </Space>
        </Card>
      )}

      {/* === STEP 2: Done === */}
      {current === 2 && boundUser && (
        <Result
          status="success"
          title="Account bound successfully"
          subTitle="Session is encrypted and stored. Agent will pick up this account on next reload."
          extra={[
            <Card key="info" size="small" style={{ textAlign: 'left', marginBottom: 16 }}>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Telegram User ID">
                  <Text code>{boundUser.id || '—'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Username">
                  {boundUser.username ? `@${boundUser.username}` : <Text type="secondary">(none)</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="First name">
                  {boundUser.firstName || <Text type="secondary">—</Text>}
                </Descriptions.Item>
                <Descriptions.Item label="Phone">+{boundUser.phone || phone.replace('+', '')}</Descriptions.Item>
                <Descriptions.Item label="Account ID">
                  <Text code style={{ fontSize: 11 }}>{accountId}</Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>,
            <Button key="back" type="primary" onClick={() => navigate('/accounts')}>
              Back to Accounts
            </Button>,
            <Button
              key="more"
              onClick={() => {
                setCurrent(0);
                setAccountId(null);
                setBoundUser(null);
                setNeedsPassword(false);
                setupForm.resetFields();
                verifyForm.resetFields();
              }}
            >
              Bind Another
            </Button>,
          ]}
        />
      )}
    </div>
  );
}
