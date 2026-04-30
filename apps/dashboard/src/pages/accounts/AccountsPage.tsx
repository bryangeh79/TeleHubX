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
  Popconfirm,
  message as antdMessage,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
  RedoOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { accountsApi, slotsApi } from '../../services/api';

type Role = 'cs' | 'ad' | 'hybrid';
type AccountStatus = 'online' | 'offline' | 'connecting' | 'error' | 'banned';
type SlotStatus = 'vacant' | 'occupied' | 'released';

interface ApiAccount {
  id: string;
  phoneNumber: string;
  role: Role;
  status: AccountStatus;
  warmupPhase: number;
  healthScore: number;
  lastActiveAt: string | null;
  boundIp: string | null;
  sessionEncrypted: boolean;
  createdAt: string;
}

interface ApiSlot {
  id: string;
  no: number;
  status: SlotStatus;
  accountId: string | null;
  account: ApiAccount | null;
  lastReleasedAt: string | null;
  notes: string | null;
  createdAt: string;
}

const ROLE_COLOR: Record<Role, string> = {
  cs: 'blue',
  ad: 'green',
  hybrid: 'orange',
};

const STATUS_BADGE: Record<AccountStatus, 'success' | 'default' | 'error' | 'processing' | 'warning'> = {
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
  const [statusFilter, setStatusFilter] = useState<AccountStatus | undefined>();
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await slotsApi.list();
      setSlots(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load slots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleReset = async (slot: ApiSlot) => {
    try {
      await slotsApi.reset(slot.id);
      antdMessage.success(`Slot No.${slot.no} reset to vacant — ready for new bind`);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Reset failed');
    }
  };

  const handleRelease = async (slot: ApiSlot) => {
    if (!slot.account) return;
    try {
      await accountsApi.delete(slot.account.id);
      antdMessage.warning(
        `Account on slot No.${slot.no} deleted. Slot is now "released" — click Reset to free it.`,
      );
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  // Apply filters only to occupied slots; released/vacant always shown so user can manage them
  const filtered = slots.filter((s) => {
    if (s.status !== 'occupied') return true;
    const a = s.account;
    if (!a) return true;
    if (phoneFilter && !a.phoneNumber.includes(phoneFilter)) return false;
    if (roleFilter && a.role !== roleFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const occupiedCount = slots.filter((s) => s.status === 'occupied').length;
  const releasedCount = slots.filter((s) => s.status === 'released').length;

  const columns: ColumnsType<ApiSlot> = [
    {
      title: 'No.',
      key: 'no',
      width: 70,
      align: 'center',
      render: (_, slot) => (
        <Typography.Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {String(slot.no).padStart(2, '0')}
        </Typography.Text>
      ),
    },
    {
      title: 'Phone',
      key: 'phoneNumber',
      width: 180,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          return <Typography.Text code>{slot.account.phoneNumber}</Typography.Text>;
        }
        if (slot.status === 'released') {
          return <Typography.Text type="warning">slot released — needs reset</Typography.Text>;
        }
        return <Typography.Text type="secondary">vacant</Typography.Text>;
      },
    },
    {
      title: 'Role',
      key: 'role',
      width: 90,
      render: (_, slot) =>
        slot.account ? (
          <Tag color={ROLE_COLOR[slot.account.role]}>{slot.account.role.toUpperCase()}</Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 130,
      render: (_, slot) => {
        if (slot.status === 'released') {
          return <Badge status="error" text="released" />;
        }
        if (slot.status === 'vacant') {
          return <Badge status="default" text="vacant" />;
        }
        const a = slot.account;
        return a ? <Badge status={STATUS_BADGE[a.status]} text={a.status} /> : <Badge status="default" text="—" />;
      },
    },
    {
      title: 'Warmup',
      key: 'warmupPhase',
      width: 80,
      render: (_, slot) => (slot.account ? <Tag>P{slot.account.warmupPhase}</Tag> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Health',
      key: 'healthScore',
      width: 75,
      render: (_, slot) => {
        if (!slot.account) return <Typography.Text type="secondary">—</Typography.Text>;
        const n = slot.account.healthScore;
        const color = n >= 80 ? '#52c41a' : n >= 60 ? '#faad14' : n >= 30 ? '#fa8c16' : '#f5222d';
        return <Typography.Text style={{ color, fontWeight: 600 }}>{n}</Typography.Text>;
      },
    },
    {
      title: 'Session',
      key: 'sessionEncrypted',
      width: 110,
      render: (_, slot) => {
        if (!slot.account) return <Typography.Text type="secondary">—</Typography.Text>;
        return slot.account.sessionEncrypted ? (
          <Tooltip title="Encrypted at rest (AES-256-GCM)">
            <Tag icon={<LockOutlined />} color="green">encrypted</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="Stored as plaintext — set SESSION_ENCRYPTION_KEY in .env">
            <Tag icon={<UnlockOutlined />} color="orange">plain</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Last Active',
      key: 'lastActiveAt',
      render: (_, slot) => {
        if (slot.status === 'released' && slot.lastReleasedAt) {
          return (
            <Tooltip title="Slot was released at this time">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                released {dayjs(slot.lastReleasedAt).format('MM-DD HH:mm')}
              </Typography.Text>
            </Tooltip>
          );
        }
        const v = slot.account?.lastActiveAt;
        return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          return (
            <Space size={4}>
              <Button size="small" onClick={() => navigate(`/accounts/${slot.account!.id}`)}>
                Detail
              </Button>
              <Popconfirm
                title={`Delete account on slot No.${slot.no}?`}
                description={
                  <div style={{ maxWidth: 280 }}>
                    Removes the encrypted session and all account-bound data.
                    Slot No.{slot.no} becomes <Typography.Text strong>released</Typography.Text>{' '}
                    and stays parked until you click <Typography.Text strong>Reset</Typography.Text>.
                  </div>
                }
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleRelease(slot)}
              >
                <Button size="small" danger icon={<LogoutOutlined />}>
                  Release
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        if (slot.status === 'released') {
          return (
            <Popconfirm
              title={`Reset slot No.${slot.no}?`}
              description="This wipes the released marker. The next new account binding will take this slot. Past audit history (campaigns, leads) stays attached to the old account UUID."
              okText="Reset to Vacant"
              okButtonProps={{ danger: false }}
              onConfirm={() => handleReset(slot)}
            >
              <Button size="small" type="primary" icon={<RedoOutlined />}>
                Reset
              </Button>
            </Popconfirm>
          );
        }
        // vacant
        return (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            ready for next bind
          </Typography.Text>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          账号{' '}
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
            （已占用 {occupiedCount}{releasedCount > 0 ? `，已释放 ${releasedCount}` : ''}）
          </Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => navigate('/accounts/import')}>
            批量导入
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounts/bind')}>
            新建账号
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索手机号..."
          prefix={<SearchOutlined />}
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          placeholder="角色"
          allowClear
          style={{ width: 120 }}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v)}
          options={[
            { value: 'cs',     label: '客服 CS' },
            { value: 'ad',     label: '广告 AD' },
            { value: 'hybrid', label: '混合 Hybrid' },
          ]}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 140 }}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: 'online',     label: '在线' },
            { value: 'offline',    label: '离线' },
            { value: 'connecting', label: '连接中' },
            { value: 'error',      label: '异常' },
            { value: 'banned',     label: '已封禁' },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        size="middle"
        rowClassName={(slot) => (slot.status === 'released' ? 'slot-row-released' : '')}
      />

      <style>{`
        .slot-row-released {
          background: #fff7e6 !important;
        }
      `}</style>
    </div>
  );
}
