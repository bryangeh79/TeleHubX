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
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
  RedoOutlined,
  LogoutOutlined,
  TeamOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import GroupsDrawer from './groups/GroupsDrawer';
import GroupSettingsModal from './groups/GroupSettingsModal';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { accountsApi, executionGroupsApi, proxiesApi, slotsApi } from '../../services/api';
import { useT } from '../../i18n';

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

/** 手机国际区号 -> 国名（中文）。长 prefix 优先匹配。 */
const PHONE_COUNTRY: Array<[string, string]> = [
  ['+852', '香港'], ['+853', '澳门'], ['+886', '台湾'],
  ['+1',  '美国/加拿大'], ['+7',  '俄罗斯'],
  ['+33', '法国'], ['+34', '西班牙'], ['+39', '意大利'], ['+44', '英国'], ['+49', '德国'], ['+55', '巴西'],
  ['+60', '马来西亚'], ['+62', '印度尼西亚'], ['+63', '菲律宾'], ['+65', '新加坡'], ['+66', '泰国'],
  ['+81', '日本'], ['+82', '韩国'], ['+84', '越南'], ['+86', '中国'], ['+90', '土耳其'],
  ['+91', '印度'], ['+92', '巴基斯坦'], ['+95', '缅甸'], ['+98', '伊朗'],
  ['+971', 'UAE'], ['+966', '沙特'], ['+972', '以色列'],
];

function phoneCountry(phone: string): string | null {
  const norm = phone.startsWith('+') ? phone : '+' + phone;
  for (const [code, name] of PHONE_COUNTRY) {
    if (norm.startsWith(code)) return name;
  }
  return null;
}

/** 紧凑的相对时间：刚刚 / X分钟前 / X小时前 / X天前 / MM-DD HH:mm（更早）。 */
function compactRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = dayjs(iso);
  const diffMin = dayjs().diff(t, 'minute');
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = dayjs().diff(t, 'hour');
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = dayjs().diff(t, 'day');
  if (diffDay < 30) return `${diffDay} 天前`;
  return t.format('MM-DD HH:mm');
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
  executionGroupId: string | null;
  sessionEncrypted: boolean;
  createdAt: string;
}

const SF_PRO_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, sans-serif';

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
  const t = useT();
  const [phoneFilter, setPhoneFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | undefined>();
  const [statusFilter, setStatusFilter] = useState<AccountStatus | undefined>();
  const [slots, setSlots] = useState<ApiSlot[]>([]);
  const [proxyMap, setProxyMap] = useState<Map<string, ApiProxy & { seq: number }>>(new Map());
  const [groupMap, setGroupMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [groupsDrawerOpen, setGroupsDrawerOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [slotsRes, proxiesRes, groupsRes] = await Promise.all([
        slotsApi.list(),
        proxiesApi.list().catch(() => ({ data: [] })),
        executionGroupsApi.list().catch(() => ({ data: [] })),
      ]);
      setSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
      const proxyList: ApiProxy[] = Array.isArray(proxiesRes.data) ? proxiesRes.data : [];
      // Sort by id for deterministic numbering, then assign sequence #1..N
      const sortedProxies = [...proxyList].sort((a, b) => a.id.localeCompare(b.id));
      setProxyMap(new Map(sortedProxies.map((p, idx) => [p.id, { ...p, seq: idx + 1 }])));

      const groupList: Array<{ id: string; slotNum: number }> = Array.isArray(groupsRes.data) ? groupsRes.data : [];
      setGroupMap(new Map(groupList.map((g) => [g.id, g.slotNum])));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.resetFailed'));
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.deleteFailed'));
    }
  };

  /**
   * 重置该账号的 GramJS 客户端连接（用于 wedged client 自助修复）。
   * 仅设标志位，agent 在 ≤30s 下次 poll 时销毁旧实例 + 用同 session 新建。
   * 不重新登录，不动 sessionString。
   */
  const handleResetConnection = async (slot: ApiSlot) => {
    if (!slot.account) return;
    try {
      await accountsApi.resetConnection(slot.account.id);
      antdMessage.success(t('account.resetConnSent'));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
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
      title: t('page.accounts.col.no'),
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
      title: t('common.phone'),
      key: 'phoneNumber',
      width: 180,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          const country = phoneCountry(slot.account.phoneNumber);
          return (
            <div style={{ lineHeight: 1.2 }}>
              <Typography.Text strong style={{
                fontSize: 15,
                fontFamily: SF_PRO_FONT,
                fontFeatureSettings: '"tnum", "ss01"',
                letterSpacing: 0.2,
              }}>
                {slot.account.phoneNumber}
              </Typography.Text>
              <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                {country ?? <span style={{ fontStyle: 'italic' }}>{t('page.accounts.unknownArea')}</span>}
              </div>
            </div>
          );
        }
        if (slot.status === 'released') {
          return <Typography.Text type="warning">{t('page.accounts.status.released')}</Typography.Text>;
        }
        return <Typography.Text type="secondary">{t('page.accounts.status.vacant')}</Typography.Text>;
      },
    },
    {
      title: t('common.role'),
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
      title: t('page.accounts.col.group'),
      key: 'executionGroupId',
      width: 80,
      render: (_, slot) => {
        if (!slot.account) return <Typography.Text type="secondary">—</Typography.Text>;
        const gid = slot.account.executionGroupId;
        if (!gid) return <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t('page.accounts.notGrouped')}</Typography.Text>;
        const slotNum = groupMap.get(gid);
        return slotNum
          ? <Tag color="blue" style={{ fontFamily: SF_PRO_FONT }}>{t('page.accounts.col.group')} {slotNum}</Tag>
          : <Typography.Text type="secondary" style={{ fontSize: 11 }}>?</Typography.Text>;
      },
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 150,
      render: (_, slot) => {
        if (slot.status === 'released') {
          return <Badge status="error" text={t('page.accounts.status.released')} />;
        }
        if (slot.status === 'vacant') {
          return <Badge status="default" text={t('page.accounts.status.vacant')} />;
        }
        const a = slot.account;
        if (!a) return <Badge status="default" text="—" />;
        const STATUS_LABEL: Record<AccountStatus, string> = {
          online: t('page.accounts.status.online'),
          offline: t('page.accounts.status.offline'),
          connecting: t('page.accounts.status.connecting'),
          error: t('page.accounts.status.error'),
          banned: t('page.accounts.status.banned'),
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
      title: 'VPN',
      key: 'proxy',
      width: 95,
      render: (_, slot) => {
        if (!slot.account) return <Typography.Text type="secondary">—</Typography.Text>;
        const a = slot.account;
        const proxy = a.proxyId ? proxyMap.get(a.proxyId) : null;
        if (proxy) {
          return (
            <Tooltip
              title={
                <div>
                  <div><b>{proxy.name}</b></div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {proxy.type.toUpperCase()} · {proxy.host}:{proxy.port}
                  </div>
                  {proxy.country && <div>{proxy.country}</div>}
                  {a.boundIp && <div style={{ fontFamily: 'monospace', fontSize: 11 }}>IP: {a.boundIp}</div>}
                </div>
              }
            >
              <Tag color="cyan" style={{ marginRight: 0, cursor: 'help' }}>VPN #{proxy.seq}</Tag>
            </Tooltip>
          );
        }
        return (
          <Tooltip title="使用宿主机系统默认 VPN（建议每号绑定专属代理避免共享 IP）">
            <Tag style={{ marginRight: 0, cursor: 'help' }}>{t('page.accounts.proxy.system')}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: t('page.accounts.col.warmup'),
      key: 'warmupPhase',
      width: 80,
      render: (_, slot) => (slot.account ? <Tag>P{slot.account.warmupPhase}</Tag> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: t('common.health'),
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
            <Tag icon={<LockOutlined />} color="green">{t('page.accounts.session.encrypted')}</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="明文存储 — 请在 .env 设置 SESSION_ENCRYPTION_KEY">
            <Tag icon={<UnlockOutlined />} color="orange">{t('page.accounts.session.plain')}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: t('page.accounts.col.lastActive'),
      key: 'lastActiveAt',
      width: 110,
      render: (_, slot) => {
        if (slot.status === 'released' && slot.lastReleasedAt) {
          return (
            <Tooltip title={`槽位释放于 ${dayjs(slot.lastReleasedAt).format('YYYY-MM-DD HH:mm')}`}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                释放 · {compactRelative(slot.lastReleasedAt)}
              </Typography.Text>
            </Tooltip>
          );
        }
        const v = slot.account?.lastActiveAt;
        if (!v) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
            <Typography.Text style={{ fontSize: 12 }}>{compactRelative(v)}</Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('page.accounts.col.actions'),
      key: 'actions',
      width: 320,
      render: (_, slot) => {
        if (slot.status === 'occupied' && slot.account) {
          return (
            <Space size={4}>
              <Button size="small" onClick={() => navigate(`/accounts/${slot.account!.id}`)}>
                {t('page.accounts.action.detail')}
              </Button>
              <Popconfirm
                title={t('account.resetConnConfirm')}
                description={t('account.resetConnDesc')}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() => handleResetConnection(slot)}
              >
                <Tooltip title={t('account.resetConnTip')}>
                  <Button size="small" icon={<ThunderboltOutlined />}>
                    {t('account.btnResetConn')}
                  </Button>
                </Tooltip>
              </Popconfirm>
              <Popconfirm
                title={`${t('page.accounts.action.release')} No.${slot.no}?`}
                okText={t('common.delete')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}
                onConfirm={() => handleRelease(slot)}
              >
                <Button size="small" danger icon={<LogoutOutlined />}>
                  {t('page.accounts.action.release')}
                </Button>
              </Popconfirm>
            </Space>
          );
        }
        if (slot.status === 'released') {
          return (
            <Popconfirm
              title={`${t('page.accounts.action.reset')} No.${slot.no}?`}
              okText={t('page.accounts.action.reset')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: false }}
              onConfirm={() => handleReset(slot)}
            >
              <Button size="small" type="primary" icon={<RedoOutlined />}>
                {t('page.accounts.action.reset')}
              </Button>
            </Popconfirm>
          );
        }
        // vacant
        return (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t('page.accounts.canBind')}
          </Typography.Text>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('nav.accounts')}{' '}
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
            （{t('common.online')} {occupiedCount}{releasedCount > 0 ? `, free ${releasedCount}` : ''}）
          </Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            {t('common.refresh')}
          </Button>
          <Button icon={<TeamOutlined />} onClick={() => setGroupsDrawerOpen(true)}>
            {t('nav.groups')}
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setGroupSettingsOpen(true)}>
            {t('common.edit')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/accounts/bind')}>
            {t('page.accounts.add')}
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('common.search')}
          prefix={<SearchOutlined />}
          value={phoneFilter}
          onChange={(e) => setPhoneFilter(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          placeholder={t('common.role')}
          allowClear
          style={{ width: 120 }}
          value={roleFilter}
          onChange={(v) => setRoleFilter(v)}
          options={[
            { value: 'cs',     label: t('page.accounts.role.cs') },
            { value: 'ad',     label: t('page.accounts.role.ad') },
            { value: 'hybrid', label: t('page.accounts.role.hybrid') },
          ]}
        />
        <Select
          placeholder={t('common.status')}
          allowClear
          style={{ width: 140 }}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: 'online',     label: t('page.accounts.status.online') },
            { value: 'offline',    label: t('page.accounts.status.offline') },
            { value: 'connecting', label: t('page.accounts.status.connecting') },
            { value: 'error',      label: t('page.accounts.status.error') },
            { value: 'banned',     label: t('page.accounts.status.banned') },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        size="small"
        rowClassName={(slot) => (slot.status === 'released' ? 'slot-row-released' : '')}
      />

      <style>{`
        .slot-row-released {
          background: #fff7e6 !important;
        }
      `}</style>

      <GroupsDrawer
        open={groupsDrawerOpen}
        onClose={() => setGroupsDrawerOpen(false)}
        onChange={() => void reload()}
      />
      <GroupSettingsModal
        open={groupSettingsOpen}
        onClose={() => setGroupSettingsOpen(false)}
        onChange={() => void reload()}
      />
    </div>
  );
}
