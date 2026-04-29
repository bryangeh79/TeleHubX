import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Tag,
  Badge,
  Input,
  Select,
  Space,
  Typography,
  Tooltip,
  message as antdMessage,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { accountsApi } from '../../services/api';

type Role = 'cs' | 'ad' | 'hybrid';
type Status = 'online' | 'offline' | 'connecting' | 'error' | 'banned';

interface ApiAccount {
  id: string;
  phoneNumber: string;
  role: Role;
  status: Status;
  warmupPhase: number;
  healthScore: number;
  lastActiveAt: string | null;
  boundIp: string | null;
  sessionEncrypted: boolean;
  createdAt: string;
}

const ROLE_COLOR: Record<Role, string> = {
  cs: 'blue',
  ad: 'green',
  hybrid: 'orange',
};

const STATUS_BADGE: Record<Status, 'success' | 'default' | 'error' | 'processing' | 'warning'> = {
  online:     'success',
  offline:    'default',
  connecting: 'processing',
  error:      'warning',
  banned:     'error',
};

export default function AccountsPage() {
  const navigate = useNavigate();
  const [phoneFilter, setPhoneFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | undefined>();
  const [statusFilter, setStatusFilter] = useState<Status | undefined>();
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await accountsApi.list();
      setAccounts(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const data = accounts.filter((a) => {
    if (phoneFilter && !a.phoneNumber.includes(phoneFilter)) return false;
    if (roleFilter && a.role !== roleFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const columns: ColumnsType<ApiAccount> = [
    {
      title: 'Phone',
      dataIndex: 'phoneNumber',
      key: 'phoneNumber',
      width: 180,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 90,
      render: (role: Role) => <Tag color={ROLE_COLOR[role]}>{role.toUpperCase()}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: Status) => <Badge status={STATUS_BADGE[status]} text={status} />,
    },
    {
      title: 'Warmup',
      dataIndex: 'warmupPhase',
      key: 'warmupPhase',
      width: 90,
      render: (n: number) => <Tag>P{n}</Tag>,
    },
    {
      title: 'Health',
      dataIndex: 'healthScore',
      key: 'healthScore',
      width: 80,
      render: (n: number) => {
        const color = n >= 80 ? '#52c41a' : n >= 60 ? '#faad14' : n >= 30 ? '#fa8c16' : '#f5222d';
        return <Typography.Text style={{ color, fontWeight: 600 }}>{n}</Typography.Text>;
      },
    },
    {
      title: 'Session',
      dataIndex: 'sessionEncrypted',
      key: 'sessionEncrypted',
      width: 100,
      render: (encrypted: boolean) =>
        encrypted ? (
          <Tooltip title="Encrypted at rest (AES-256-GCM)">
            <Tag icon={<LockOutlined />} color="green">encrypted</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="Stored as plaintext — set SESSION_ENCRYPTION_KEY in .env to fix">
            <Tag icon={<UnlockOutlined />} color="orange">plain</Tag>
          </Tooltip>
        ),
    },
    {
      title: 'Last Active',
      dataIndex: 'lastActiveAt',
      key: 'lastActiveAt',
      render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button size="small" onClick={() => navigate(`/accounts/${record.id}`)}>
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Accounts <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>({data.length})</Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            Refresh
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => navigate('/accounts/import')}>
            Import CSV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounts/bind')}>
            New Account
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search phone..."
          prefix={<SearchOutlined />}
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          placeholder="Role"
          allowClear
          style={{ width: 120 }}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v)}
          options={[
            { value: 'cs',     label: 'CS' },
            { value: 'ad',     label: 'AD' },
            { value: 'hybrid', label: 'Hybrid' },
          ]}
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: 140 }}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: 'online',     label: 'Online' },
            { value: 'offline',    label: 'Offline' },
            { value: 'connecting', label: 'Connecting' },
            { value: 'error',      label: 'Error' },
            { value: 'banned',     label: 'Banned' },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
      />
    </div>
  );
}
