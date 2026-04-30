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
import { accountsApi, proxiesApi, slotsApi } from '../../services/api';

/** Telegram paper-plane SVG, sized to inline with text. */
const TelegramIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#229ED9" style={{ verticalAlign: '-2px' }}>
    <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

interface ApiProxy {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  country?: string | null;
}

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
  proxyId: string | null;
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
  const [proxyMap, setProxyMap] = useState<Map<string, ApiProxy>>(new Map());
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [slotsRes, proxiesRes] = await Promise.all([
        slotsApi.list(),
        proxiesApi.list().catch(() => ({ data: [] })),
      ]);
      setSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
      const list: ApiProxy[] = Array.isArray(proxiesRes.data) ? proxiesRes.data : [];
      setProxyMap(new Map(list.map((p) => [p.id, p])));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载槽位失败');
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
      antdMessage.success(`槽位 No.${slot.no} 已重置 — 可绑定新账号`);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '重置失败');
    }
  };

  const handleRelease = async (slot: ApiSlot) => {
    if (!slot.account) return;
    try {
      await accountsApi.delete(slot.account.id);
      antdMessage.warning(
        `No.${slot.no} 槽位的账号已删除。槽位变为「已释放」 — 点击「重置」可释放槽位。`,
      );
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
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
      title: '编号',
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
      title: '手机号',
      key: 'phoneNumber',
      width: 180,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          return <Typography.Text code>{slot.account.phoneNumber}</Typography.Text>;
        }
        if (slot.status === 'released') {
          return <Typography.Text type="warning">已释放 — 需要重置</Typography.Text>;
        }
        return <Typography.Text type="secondary">空闲</Typography.Text>;
      },
    },
    {
      title: '角色',
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
      title: '状态',
      key: 'status',
      width: 150,
      render: (_, slot) => {
        if (slot.status === 'released') {
          return <Badge status="error" text="已释放" />;
        }
        if (slot.status === 'vacant') {
          return <Badge status="default" text="空闲" />;
        }
        const a = slot.account;
        if (!a) return <Badge status="default" text="—" />;
        const STATUS_LABEL: Record<AccountStatus, string> = {
          online: '在线', offline: '离线', connecting: '连接中', error: '异常', banned: '已封禁',
        };
        return (
          <Space size={6}>
            <Tooltip title="Telegram 账号">
              <span style={{ display: 'inline-flex' }}><TelegramIcon size={14} /></span>
            </Tooltip>
            <Badge status={STATUS_BADGE[a.status]} text={STATUS_LABEL[a.status]} />
          </Space>
        );
      },
    },
    {
      title: 'VPN / IP',
      key: 'proxy',
      width: 200,
      render: (_, slot) => {
        if (!slot.account) return <Typography.Text type="secondary">—</Typography.Text>;
        const a = slot.account;
        const proxy = a.proxyId ? proxyMap.get(a.proxyId) : null;
        const ip = a.boundIp;
        if (!proxy && !ip) {
          return <Tag color="orange">未绑定</Tag>;
        }
        return (
          <Space direction="vertical" size={0}>
            {proxy ? (
              <Tooltip title={`${proxy.type.toUpperCase()} · ${proxy.host}:${proxy.port}${proxy.country ? ' · ' + proxy.country : ''}`}>
                <Tag color="cyan" style={{ marginRight: 0 }}>{proxy.name}</Tag>
              </Tooltip>
            ) : null}
            {ip ? (
              <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                {ip}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '养号',
      key: 'warmupPhase',
      width: 80,
      render: (_, slot) => (slot.account ? <Tag>P{slot.account.warmupPhase}</Tag> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: '健康分',
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
          <Tooltip title="AES-256-GCM 加密存储">
            <Tag icon={<LockOutlined />} color="green">已加密</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="明文存储 — 请在 .env 设置 SESSION_ENCRYPTION_KEY">
            <Tag icon={<UnlockOutlined />} color="orange">明文</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '最后活跃',
      key: 'lastActiveAt',
      render: (_, slot) => {
        if (slot.status === 'released' && slot.lastReleasedAt) {
          return (
            <Tooltip title="该槽位释放时间">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                释放于 {dayjs(slot.lastReleasedAt).format('MM-DD HH:mm')}
              </Typography.Text>
            </Tooltip>
          );
        }
        const v = slot.account?.lastActiveAt;
        return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          return (
            <Space size={4}>
              <Button size="small" onClick={() => navigate(`/accounts/${slot.account!.id}`)}>
                详情
              </Button>
              <Popconfirm
                title={`删除 No.${slot.no} 槽位的账号？`}
                description={
                  <div style={{ maxWidth: 280 }}>
                    将删除加密的 session 及账号绑定的所有数据。
                    槽位 No.{slot.no} 状态变为 <Typography.Text strong>已释放</Typography.Text>，
                    需点击 <Typography.Text strong>重置</Typography.Text> 后才能绑定新账号。
                  </div>
                }
                okText="删除"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleRelease(slot)}
              >
                <Button size="small" danger icon={<LogoutOutlined />}>
                  释放
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        if (slot.status === 'released') {
          return (
            <Popconfirm
              title={`重置 No.${slot.no} 槽位？`}
              description="将清除释放标记。下次绑定新账号将使用该槽位。历史记录（广告、线索）仍绑定到旧账号 UUID。"
              okText="重置为空闲"
              okButtonProps={{ danger: false }}
              onConfirm={() => handleReset(slot)}
            >
              <Button size="small" type="primary" icon={<RedoOutlined />}>
                重置
              </Button>
            </Popconfirm>
          );
        }
        // vacant
        return (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            可绑定新账号
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
