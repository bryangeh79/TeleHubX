import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message as antdMessage,
  Popconfirm,
  Tooltip,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { proxiesApi } from '../../services/api';

type ProxyType = 'socks5' | 'socks4' | 'http' | 'https' | 'mtproto' | 'openvpn';
type ProxyStatus = 'active' | 'disabled' | 'dead';

interface ProxyRow {
  id: string;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  passwordEncrypted: boolean;
  country?: string;
  isp?: string;
  status: ProxyStatus;
  notes?: string;
  createdAt: string;
}

interface FormValues {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  isp?: string;
  status?: ProxyStatus;
  notes?: string;
}

const TYPE_OPTIONS: Array<{ value: ProxyType; label: string; hint: string }> = [
  { value: 'socks5',  label: 'SOCKS5',   hint: 'Recommended — native GramJS support, residential/mobile compatible' },
  { value: 'socks4',  label: 'SOCKS4',   hint: 'Older variant; SOCKS5 preferred unless source restricts' },
  { value: 'http',    label: 'HTTP',     hint: 'Limited compatibility with MTProto traffic' },
  { value: 'https',   label: 'HTTPS',    hint: 'Limited compatibility with MTProto traffic' },
  { value: 'mtproto', label: 'MTProto',  hint: 'Telegram-native protocol; harder to isolate per account' },
  { value: 'openvpn', label: 'OpenVPN',  hint: 'OS-level tunnel — informational only, not bound per account by GramJS' },
];

const STATUS_COLOR: Record<ProxyStatus, string> = {
  active:   'green',
  disabled: 'default',
  dead:     'red',
};

const TYPE_COLOR: Record<ProxyType, string> = {
  socks5:  'green',
  socks4:  'cyan',
  http:    'blue',
  https:   'geekblue',
  mtproto: 'purple',
  openvpn: 'orange',
};

export default function ProxiesPage() {
  const [rows, setRows] = useState<ProxyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await proxiesApi.list();
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load proxies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'socks5', port: 1080, status: 'active' });
    setModalOpen(true);
  };

  const openEdit = (row: ProxyRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      type: row.type,
      host: row.host,
      port: row.port,
      username: row.username,
      // password intentionally not pre-filled — write-only
      country: row.country,
      isp: row.isp,
      status: row.status,
      notes: row.notes,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // Strip empty strings so backend treats them as omitted
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== '') payload[k] = v;
    }
    setSaving(true);
    try {
      if (editing) {
        await proxiesApi.update(editing.id, payload);
        antdMessage.success(`Updated "${values.name}"`);
      } else {
        await proxiesApi.create(payload);
        antdMessage.success(`Created "${values.name}"`);
      }
      setModalOpen(false);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: ProxyRow) => {
    try {
      await proxiesApi.delete(row.id);
      antdMessage.success(`Deleted "${row.name}"`);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const columns: ColumnsType<ProxyRow> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: ProxyType) => <Tag color={TYPE_COLOR[t]}>{t.toUpperCase()}</Tag>,
    },
    {
      title: 'Endpoint',
      key: 'endpoint',
      render: (_, r) => (
        <Typography.Text code style={{ fontSize: 12 }}>
          {r.host}:{r.port}
        </Typography.Text>
      ),
    },
    {
      title: 'Auth',
      key: 'auth',
      width: 120,
      render: (_, r) =>
        r.username ? (
          <Tooltip title={r.passwordEncrypted ? 'password encrypted at rest' : 'password plaintext (set SESSION_ENCRYPTION_KEY)'}>
            <Tag color={r.passwordEncrypted ? 'green' : 'orange'}>{r.username}</Tag>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Country',
      dataIndex: 'country',
      key: 'country',
      width: 90,
      render: (v?: string) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'ISP',
      dataIndex: 'isp',
      key: 'isp',
      width: 120,
      render: (v?: string) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: ProxyStatus) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Popconfirm
            title={`Delete "${row.name}"?`}
            description="Accounts using this proxy will lose their reference."
            onConfirm={() => remove(row)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <GlobalOutlined style={{ marginRight: 8 }} />
          Proxies <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>({rows.length})</Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Proxy
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="一号一固定 IP — 不要轮换"
        description={
          <>
            Telegram 把 Session 和 IP 绑定到 DC，频繁换 IP 会触发 re-authorization 甚至封号。
            建议在这里维护一个池：每个广告号在 BindWizard 里挑一个 proxy，绑定后保持不变。
            类型推荐 <Typography.Text code>SOCKS5</Typography.Text> 住宅 / 移动代理。
          </>
        }
      />

      <Table
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
      />

      <Modal
        title={editing ? `Edit proxy: ${editing.name}` : 'Add proxy'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okText={editing ? 'Save' : 'Create'}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            name="name"
            label="Friendly Name"
            extra="Tenants pick by this name in the BindWizard dropdown."
            rules={[
              { required: true, message: 'Required' },
              { max: 64, message: 'Max 64 chars' },
            ]}
          >
            <Input placeholder="e.g. MY-Mobile-1, US-Resi-East" />
          </Form.Item>

          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true, message: 'Required' }]}
          >
            <Select
              options={TYPE_OPTIONS.map(opt => ({
                value: opt.value,
                label: opt.label,
              }))}
              optionRender={(option) => {
                const meta = TYPE_OPTIONS.find(t => t.value === option.value);
                return (
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ fontWeight: 500 }}>{meta?.label}</div>
                    {meta && (
                      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>
                        {meta.hint}
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="host"
              label="Host / IP"
              style={{ flex: 1 }}
              rules={[
                { required: true, message: 'Required' },
                { max: 255 },
              ]}
            >
              <Input placeholder="1.2.3.4 or proxy.example.com" />
            </Form.Item>
            <Form.Item
              name="port"
              label="Port"
              style={{ width: 120 }}
              rules={[
                { required: true, message: 'Required' },
                { type: 'number', min: 1, max: 65535, message: '1-65535' },
              ]}
            >
              <InputNumber style={{ width: '100%' }} placeholder="1080" />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="username" label="Username">
            <Input placeholder="optional" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            extra={editing ? 'Leave blank to keep existing. Type a new value to overwrite.' : undefined}
          >
            <Input.Password
              placeholder={editing ? '(unchanged)' : 'optional'}
              autoComplete="new-password"
            />
          </Form.Item>

          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="country" label="Country" style={{ flex: 1 }}>
              <Input placeholder="MY, US, ..." />
            </Form.Item>
            <Form.Item name="isp" label="ISP" style={{ flex: 2 }}>
              <Input placeholder="Maxis, Comcast, ..." />
            </Form.Item>
          </Space.Compact>

          <Form.Item name="status" label="Status">
            <Select
              options={[
                { value: 'active',   label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'dead',     label: 'Dead' },
              ]}
            />
          </Form.Item>

          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} maxLength={500} showCount placeholder="Internal notes (optional)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
