import { useState } from 'react';
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
} from 'antd';
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

interface Account {
  id: string;
  phone: string;
  role: 'cs' | 'ad' | 'hybrid';
  status: 'online' | 'offline' | 'banned' | 'warmup';
  warmupPhase: string;
  lastActive: string | null;
}

const ROLE_COLOR: Record<Account['role'], string> = {
  cs: 'blue',
  ad: 'green',
  hybrid: 'orange',
};

const STATUS_BADGE: Record<Account['status'], 'success' | 'default' | 'error' | 'processing'> = {
  online: 'success',
  offline: 'default',
  banned: 'error',
  warmup: 'processing',
};

// Mock data — replace with useQuery(accountsApi.list) when P1-2 server is ready
const MOCK: Account[] = [
  { id: '1', phone: '+60123456789', role: 'cs',     status: 'online',  warmupPhase: 'P4', lastActive: new Date().toISOString() },
  { id: '2', phone: '+60198765432', role: 'ad',     status: 'warmup',  warmupPhase: 'P2', lastActive: new Date().toISOString() },
  { id: '3', phone: '+60111234567', role: 'hybrid', status: 'offline', warmupPhase: 'P4', lastActive: null },
  { id: '4', phone: '+60177654321', role: 'ad',     status: 'online',  warmupPhase: 'P4', lastActive: new Date().toISOString() },
  { id: '5', phone: '+60133219876', role: 'cs',     status: 'banned',  warmupPhase: 'P4', lastActive: null },
];

export default function AccountsPage() {
  const navigate = useNavigate();
  const [phoneFilter, setPhoneFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<Account['role'] | undefined>();
  const [statusFilter, setStatusFilter] = useState<Account['status'] | undefined>();

  const data = MOCK.filter(a => {
    if (phoneFilter && !a.phone.includes(phoneFilter)) return false;
    if (roleFilter && a.role !== roleFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const columns: ColumnsType<Account> = [
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 180,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: Account['role']) => (
        <Tag color={ROLE_COLOR[role]}>{role.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: Account['status']) => (
        <Badge status={STATUS_BADGE[status]} text={status} />
      ),
    },
    {
      title: 'Warmup Phase',
      dataIndex: 'warmupPhase',
      key: 'warmupPhase',
      width: 130,
    },
    {
      title: 'Last Active',
      dataIndex: 'lastActive',
      key: 'lastActive',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—',
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
        <Typography.Title level={4} style={{ margin: 0 }}>Accounts</Typography.Title>
        <Space>
          <Button
            icon={<UploadOutlined />}
            onClick={() => navigate('/accounts/import')}
          >
            Import CSV
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/accounts/bind')}
          >
            New Account
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search phone..."
          prefix={<SearchOutlined />}
          value={phoneFilter}
          onChange={e => setPhoneFilter(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          placeholder="Role"
          allowClear
          style={{ width: 120 }}
          value={roleFilter}
          onChange={v => setRoleFilter(v)}
          options={[
            { value: 'cs',     label: 'CS' },
            { value: 'ad',     label: 'AD' },
            { value: 'hybrid', label: 'Hybrid' },
          ]}
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: 130 }}
          value={statusFilter}
          onChange={v => setStatusFilter(v)}
          options={[
            { value: 'online',  label: 'Online' },
            { value: 'offline', label: 'Offline' },
            { value: 'banned',  label: 'Banned' },
            { value: 'warmup',  label: 'Warmup' },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
      />
    </div>
  );
}
