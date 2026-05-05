import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, DatePicker, Descriptions, Form, Input, Modal,
  Popconfirm, Select, Space, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  CloudOutlined, KeyOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { cloudLicenseAdminApi } from '../../services/api';

const { Text, Paragraph, Title } = Typography;

interface CloudLicense {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantContact: string | null;
  product: string;
  plan: 'basic' | 'pro' | 'enterprise';
  maxAccounts: number;
  keyMasked: string;
  status: 'active' | 'revoked' | 'suspended';
  expiresAt: string | null;
  bound: boolean;
  machineFingerprintPreview: string | null;
  activatedAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

interface CloudUser {
  id: string;
  tenantId: string;
  tenantName: string | null;
  email: string;
  role: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

const PLAN_OPTIONS = [
  { value: 'basic',      label: 'BASIC (10 accounts)' },
  { value: 'pro',        label: 'PRO (30 accounts)' },
  { value: 'enterprise', label: 'ENTERPRISE (50 accounts)' },
];

export default function CloudTenantsTab() {
  const [licenses, setLicenses] = useState<CloudLicense[]>([]);
  const [users, setUsers]       = useState<CloudUser[]>([]);
  const [loading, setLoading]   = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<any | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const av = await cloudLicenseAdminApi.availability();
      setAvailable(!!av.data?.available);
      if (av.data?.available) {
        const [l, u] = await Promise.all([
          cloudLicenseAdminApi.listLicenses(),
          cloudLicenseAdminApi.listUsers(),
        ]);
        setLicenses(l.data?.licenses ?? []);
        setUsers(u.data?.users ?? []);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load Cloud admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // ─── create tenant ───────────────────────────────────────────────────
  const handleCreate = async () => {
    let v: any;
    try { v = await createForm.validateFields(); } catch { return; }
    setSubmitting(true);
    try {
      const res = await cloudLicenseAdminApi.createTenant({
        tenantName: v.tenantName.trim(),
        contact: v.contact?.trim() || null,
        plan: v.plan,
        expiresAt: v.expiresAt ? (v.expiresAt as Dayjs).toISOString() : null,
        email: v.email.trim().toLowerCase(),
        initialPassword: v.initialPassword,
        role: v.role || 'admin',
      });
      setCreatedResult({ ...res.data, _initialPassword: v.initialPassword });
      setCreateOpen(false);
      createForm.resetFields();
      void reload();
    } catch (err: any) {
      const d = err?.response?.data;
      antdMessage.error(d?.message ?? d?.code ?? 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── license ops ─────────────────────────────────────────────────────
  const callOp = async (label: string, p: Promise<any>) => {
    try { await p; antdMessage.success(label); void reload(); }
    catch (err: any) { antdMessage.error(err?.response?.data?.message ?? `${label} failed`); }
  };

  const askChangePlan = (lic: CloudLicense) => {
    let plan: 'basic' | 'pro' | 'enterprise' = lic.plan;
    Modal.confirm({
      title: `Change plan for ${lic.tenantName}`,
      content: (
        <div style={{ marginTop: 12 }}>
          <Text>Current: <Tag color="blue">{lic.plan.toUpperCase()}</Tag> ({lic.maxAccounts} accts)</Text>
          <div style={{ marginTop: 12 }}>
            <Text strong>New plan:</Text>{' '}
            <Select defaultValue={lic.plan} style={{ width: 240 }}
              options={PLAN_OPTIONS} onChange={(v) => { plan = v as any; }} />
          </div>
        </div>
      ),
      okText: 'Change',
      onOk: () => callOp('Plan changed', cloudLicenseAdminApi.changePlan(lic.id, plan)),
    });
  };

  const askExtend = (lic: CloudLicense) => {
    let picked: Dayjs | null = lic.expiresAt ? dayjs(lic.expiresAt) : dayjs().add(1, 'year');
    Modal.confirm({
      title: `Extend expiry — ${lic.tenantName}`,
      content: (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Current expiry: {lic.expiresAt ? dayjs(lic.expiresAt).format('YYYY-MM-DD HH:mm') : 'never'}</Text>
          <div style={{ marginTop: 12 }}>
            <DatePicker showTime defaultValue={picked!} onChange={(v) => { picked = v; }} style={{ width: 280 }} />
          </div>
        </div>
      ),
      okText: 'Extend',
      onOk: () => {
        if (!picked) return Promise.reject();
        return callOp('Subscription extended', cloudLicenseAdminApi.extendLicense(lic.id, picked.toISOString()));
      },
    });
  };

  const showResetPwd = async (u: CloudUser) => {
    try {
      const res = await cloudLicenseAdminApi.resetUserPassword(u.id);
      Modal.success({
        title: `Password reset — ${u.email}`,
        content: (
          <div>
            <Paragraph>Temporary password (deliver securely; shown only once):</Paragraph>
            <Input.Password
              readOnly
              value={res.data?.tempPassword ?? ''}
              visibilityToggle={{ visible: true, onVisibleChange: () => {} }}
              style={{ fontFamily: 'monospace', fontSize: 14 }}
            />
            <Alert type="warning" showIcon style={{ marginTop: 12 }}
              message="This temporary password is shown once. Closing this dialog removes it." />
          </div>
        ),
        width: 480,
      });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Reset failed');
    }
  };

  // ─── render ──────────────────────────────────────────────────────────
  if (available === false) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Cloud Admin not available on this install"
        description="Set LICENSE_ADMIN_TOKEN in the local server .env to the Worker ADMIN_TOKEN, then restart telehubx-server. This token never reaches the browser — it stays in the local server process."
      />
    );
  }

  const licenseColumns = [
    { title: 'Tenant',        dataIndex: 'tenantName',
      render: (n: string, r: CloudLicense) => (
        <div>
          <Text strong>{n}</Text>
          {r.tenantContact && <div><Text type="secondary" style={{ fontSize: 11 }}>{r.tenantContact}</Text></div>}
        </div>
      ),
    },
    { title: 'License',       dataIndex: 'keyMasked', width: 180,
      render: (k: string) => <Text code style={{ fontSize: 12 }}>{k}</Text>,
    },
    { title: 'Plan',          dataIndex: 'plan', width: 100,
      render: (p: string, r: CloudLicense) => <Tag color="blue">{p?.toUpperCase()} · {r.maxAccounts}</Tag>,
    },
    { title: 'Status',        dataIndex: 'status', width: 100,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'red'}>{s}</Tag>,
    },
    { title: 'Bound machine', dataIndex: 'machineFingerprintPreview', width: 150,
      render: (m: string | null) => m ? <Text code style={{ fontSize: 11 }}>{m}</Text> : <Text type="secondary">—</Text>,
    },
    { title: 'Expires',       dataIndex: 'expiresAt', width: 130,
      render: (d: string | null) => d ? dayjs(d).format('YYYY-MM-DD') : '—',
    },
    { title: 'Last verify',   dataIndex: 'lastVerifiedAt', width: 130,
      render: (d: string | null) => d ? dayjs(d).format('MM-DD HH:mm') : <Text type="secondary">never</Text>,
    },
    { title: 'Actions',       width: 290,
      render: (_: any, r: CloudLicense) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => askChangePlan(r)}>Change plan</Button>
          <Button size="small" onClick={() => askExtend(r)}>Extend</Button>
          <Popconfirm title={`Unbind machine for ${r.tenantName}?`}
            description="The customer will be able to activate from a different machine."
            onConfirm={() => callOp('Machine unbound', cloudLicenseAdminApi.unbindLicense(r.id))}>
            <Button size="small" disabled={!r.bound}>Unbind</Button>
          </Popconfirm>
          <Popconfirm title={`Revoke license for ${r.tenantName}?`}
            description="This is reversible only by issuing a new license. Existing local data on the customer machine remains intact."
            okType="danger"
            onConfirm={() => callOp('License revoked', cloudLicenseAdminApi.revokeLicense(r.id))}>
            <Button size="small" danger disabled={r.status !== 'active'}>Revoke</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const userColumns = [
    { title: 'Tenant',  dataIndex: 'tenantName',
      render: (n: string | null) => n ?? <Text type="secondary">—</Text>,
    },
    { title: 'Email',   dataIndex: 'email' },
    { title: 'Role',    dataIndex: 'role', width: 100,
      render: (r: string) => <Tag>{r?.toUpperCase()}</Tag>,
    },
    { title: 'Status',  dataIndex: 'status', width: 100,
      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag>,
    },
    { title: 'Created', dataIndex: 'createdAt', width: 130,
      render: (d: string) => dayjs(d).format('YYYY-MM-DD'),
    },
    { title: 'Actions', width: 280,
      render: (_: any, u: CloudUser) => (
        <Space size={4} wrap>
          <Button size="small" icon={<KeyOutlined />} onClick={() => showResetPwd(u)}>Reset</Button>
          {u.status === 'active'
            ? (
              <Popconfirm title={`Disable ${u.email}?`}
                description="Disabled users cannot activate or pass /license/verify on the local agent."
                okType="danger"
                onConfirm={() => callOp('User disabled', cloudLicenseAdminApi.disableUser(u.id))}>
                <Button size="small" danger>Disable</Button>
              </Popconfirm>
            )
            : <Button size="small" type="primary" onClick={() => callOp('User enabled', cloudLicenseAdminApi.enableUser(u.id))}>Enable</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>
          <CloudOutlined style={{ marginRight: 8 }} />
          Cloud Tenants & Licenses
          <Badge status={available ? 'success' : 'default'} text={available ? 'connected' : 'unknown'} style={{ marginLeft: 12 }} />
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>+ New Tenant</Button>
        </Space>
      </div>

      <Card title="Licenses" size="small" style={{ marginBottom: 16 }}>
        <Table
          dataSource={licenses}
          columns={licenseColumns as any}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Card title="Tenant Users" size="small">
        <Table
          dataSource={users}
          columns={userColumns as any}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      {/* Create Tenant Modal */}
      <Modal
        title="+ New Cloud Tenant"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={submitting}
        okText="Create"
        width={560}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ plan: 'pro', role: 'admin' }} preserve={false}>
          <Form.Item name="tenantName" label="Tenant Name" rules={[{ required: true }]}>
            <Input placeholder="ABC Customer" autoComplete="off" />
          </Form.Item>
          <Form.Item name="contact" label="Contact (optional)">
            <Input placeholder="customer-side contact line" autoComplete="off" />
          </Form.Item>
          <Form.Item name="email" label="Initial User Email"
            rules={[{ required: true }, { type: 'email', message: 'Not a valid email' }]}>
            <Input placeholder="owner@abc.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="initialPassword" label="Initial Password"
            rules={[{ required: true }, { min: 8, message: 'At least 8 characters' }]}>
            <Input.Password placeholder="≥ 8 chars" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={[
              { value: 'admin',    label: 'Admin' },
              { value: 'operator', label: 'Operator' },
              { value: 'viewer',   label: 'Viewer (read-only)' },
            ]} />
          </Form.Item>
          <Form.Item name="plan" label="Plan" rules={[{ required: true }]}>
            <Select options={PLAN_OPTIONS} />
          </Form.Item>
          <Form.Item name="expiresAt" label="Expires At (optional)">
            <DatePicker showTime style={{ width: '100%' }} placeholder="leave blank = never expires" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Created — one-time license key reveal */}
      <Modal
        open={!!createdResult}
        onCancel={() => setCreatedResult(null)}
        onOk={() => setCreatedResult(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="I have saved it"
        width={560}
        title={<span>✅ Tenant created — copy the License Key now</span>}
      >
        {createdResult && (
          <div>
            <Alert type="warning" showIcon style={{ marginBottom: 16 }}
              message="The License Key is shown once. After closing this dialog it cannot be retrieved." />
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Tenant">{createdResult.tenantName}</Descriptions.Item>
              <Descriptions.Item label="Email">{createdResult.user?.email ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Initial Password">
                <Input.Password
                  readOnly
                  value={createdResult._initialPassword ?? ''}
                  visibilityToggle={{ visible: true, onVisibleChange: () => {} }}
                  style={{ fontFamily: 'monospace' }}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Plan">
                <Tag color="blue">{String(createdResult.plan ?? '').toUpperCase()}</Tag>
                <Text type="secondary">{createdResult.maxAccounts} accounts</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Expires At">
                {createdResult.expiresAt ? dayjs(createdResult.expiresAt).format('YYYY-MM-DD HH:mm') : 'never'}
              </Descriptions.Item>
              <Descriptions.Item label="License Key">
                <Input.Password
                  readOnly
                  value={createdResult.licenseKey ?? ''}
                  visibilityToggle={{ visible: true, onVisibleChange: () => {} }}
                  style={{ fontFamily: 'monospace', fontSize: 14 }}
                />
              </Descriptions.Item>
            </Descriptions>
            <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
              Send the License Key + Email + Initial Password to the tenant
              through a secure channel. The tenant will paste them into the
              local TeleHubX dashboard at <Text code>/settings/license</Text>
              on first launch to activate the machine.
            </Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
}
