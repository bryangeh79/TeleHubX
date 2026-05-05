import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Descriptions, Form, Input, Row, Space,
  Statistic, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CrownOutlined, KeyOutlined,
  ReloadOutlined, SafetyCertificateOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { cloudLicenseApi } from '../../services/api';

const { Title, Text, Paragraph } = Typography;

interface LicenseStatus {
  configured: boolean;
  licenseKeyMasked: string | null;
  machineFingerprint: string;
  tenantName: string | null;
  userEmail: string | null;
  userRole: string | null;
  plan: string | null;
  maxAccounts: number | null;
  expiresAt: string | null;
  status: 'active' | 'revoked' | 'suspended' | 'expired' | 'unknown';
  effectiveStatus: 'active' | 'grace' | 'locked' | 'unconfigured';
  activatedAt: string | null;
  lastVerifyAt: string | null;
  lastVerifyOkAt: string | null;
  lastVerifyError: string | null;
  consecutiveVerifyFailures: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatError: string | null;
  serverBaseUrl: string;
}

const EFFECTIVE_META: Record<LicenseStatus['effectiveStatus'], { color: any; label: string; icon: any }> = {
  active:        { color: 'success', label: 'Active',        icon: <CheckCircleOutlined /> },
  grace:         { color: 'warning', label: 'Grace period',  icon: <ThunderboltOutlined /> },
  locked:        { color: 'error',   label: 'Locked',        icon: <CloseCircleOutlined /> },
  unconfigured:  { color: 'default', label: 'Not activated', icon: <KeyOutlined /> },
};

function fmtTime(iso: string | null) {
  return iso ? dayjs(iso).format('YYYY-MM-DD HH:mm:ss') : '—';
}

export default function LicensePage() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form] = Form.useForm<{ licenseKey: string; email?: string; password?: string }>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cloudLicenseApi.status();
      setStatus(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load license status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleActivate = async (values: { licenseKey: string; email?: string; password?: string }) => {
    setActivating(true);
    try {
      const email = values.email?.trim() || null;
      const password = values.password ? values.password : null;
      const res = await cloudLicenseApi.activate(values.licenseKey.trim(), email, password);
      const u = res.data?.userEmail ? ` · user=${res.data.userEmail}` : '';
      antdMessage.success(`Activated · tenant=${res.data.tenantName} plan=${res.data.plan}${u}`);
      form.resetFields();
      setStatus(res.data);
    } catch (err: any) {
      const detail = err?.response?.data;
      antdMessage.error(detail?.message ?? detail?.code ?? 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await cloudLicenseApi.refresh();
      setStatus(res.data);
      antdMessage.success('Re-verified with license server');
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const eff = status ? EFFECTIVE_META[status.effectiveStatus] : EFFECTIVE_META.unconfigured;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />
          License
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>Refresh status</Button>
          {status?.configured && (
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleRefresh} loading={refreshing}>
              Re-verify now
            </Button>
          )}
        </Space>
      </div>

      {/* Activation card — visible when not configured OR when locked */}
      {(!status?.configured || status?.effectiveStatus === 'locked') && (
        <Card
          title={<Space><KeyOutlined /> {status?.configured ? 'Re-activate license' : 'Activate this machine'}</Space>}
          style={{ marginBottom: 16 }}
        >
          {!status?.configured && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Activate this installation to start using TeleHubX."
              description="Enter the License Key, your User ID (Email) and Password from the operator. The key + user are bound to this machine on first activation. To move to another machine, ask the platform admin to unbind first."
            />
          )}
          <Form layout="vertical" form={form} onFinish={handleActivate} autoComplete="off">
            <Form.Item
              name="licenseKey"
              label="License Key"
              rules={[
                { required: true, message: 'Required' },
                { pattern: /^THX-/i, message: 'Must start with THX-' },
              ]}
            >
              <Input.Password placeholder="THX-XXXX-XXXX-XXXX" autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="email"
              label="User ID / Email"
              rules={[
                { required: true, message: 'Required' },
                { type: 'email', message: 'Not a valid email' },
              ]}
            >
              <Input placeholder="you@example.com" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Required' },
                { min: 8, message: 'At least 8 characters' },
              ]}
            >
              <Input.Password placeholder="Initial password from your operator" autoComplete="new-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={activating}>
                Activate &amp; Login
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {/* Status */}
      <Card style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic
              title="Effective Status"
              valueRender={() => (
                <Tag color={eff.color} icon={eff.icon} style={{ fontSize: 14, padding: '4px 10px' }}>
                  {eff.label}
                </Tag>
              )}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Server Status"
              valueRender={() => (
                <Tag color={status?.status === 'active' ? 'green' : status?.status === 'unknown' ? 'default' : 'red'}>
                  {status?.status ?? '—'}
                </Tag>
              )}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Plan"
              valueRender={() => <Text strong>{status?.plan?.toUpperCase() ?? '—'}</Text>}
            />
          </Col>
          <Col span={6}>
            <Statistic title="Account Quota" value={status?.maxAccounts ?? 0} suffix="accounts" />
          </Col>
        </Row>

        {status?.effectiveStatus === 'grace' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message={`License server unreachable — running in grace mode (${status.consecutiveVerifyFailures} failed verifies in a row).`}
            description={`New accounts and tasks still allowed for now. Once the grace window closes, operations will be blocked. Last error: ${status.lastVerifyError ?? 'unknown'}`}
          />
        )}
        {status?.effectiveStatus === 'locked' && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="Local TeleHubX is locked"
            description="New accounts and new tasks are blocked. Existing data remains viewable. Re-activate or extend the license to resume operations."
          />
        )}
      </Card>

      <Card title="Details" loading={loading}>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="License Key">{status?.licenseKeyMasked ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Tenant">{status?.tenantName ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="User">
            {status?.userEmail
              ? <Space><Text strong>{status.userEmail}</Text><Tag>{status.userRole?.toUpperCase() ?? 'USER'}</Tag></Space>
              : <Text type="secondary">— (legacy license, no user attached)</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Expires At">{fmtTime(status?.expiresAt ?? null)}</Descriptions.Item>
          <Descriptions.Item label="Activated At">{fmtTime(status?.activatedAt ?? null)}</Descriptions.Item>
          <Descriptions.Item label="Last Verify (success)">{fmtTime(status?.lastVerifyOkAt ?? null)}</Descriptions.Item>
          <Descriptions.Item label="Last Verify Attempt">
            <Space>
              {fmtTime(status?.lastVerifyAt ?? null)}
              {status?.lastVerifyError && <Tag color="red">{status.lastVerifyError}</Tag>}
              {status && status.consecutiveVerifyFailures > 0 && <Badge count={status.consecutiveVerifyFailures} />}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Last Heartbeat">
            <Space>
              {fmtTime(status?.lastHeartbeatAt ?? null)}
              {status?.lastHeartbeatError && <Tag color="orange">{status.lastHeartbeatError}</Tag>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Machine Fingerprint">{status?.machineFingerprint ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="License Server">
            <Text code>{status?.serverBaseUrl ?? '—'}</Text>
          </Descriptions.Item>
        </Descriptions>

        <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
          <CrownOutlined style={{ marginRight: 6 }} />
          The agent token returned during activation is stored locally in an
          AES-256-GCM encrypted file. It is never displayed in this UI nor written
          to the server log. Telegram sessions, proxies, campaigns, leads and
          assets stay on this machine and are not sent to the license server.
        </Paragraph>
      </Card>
    </div>
  );
}
