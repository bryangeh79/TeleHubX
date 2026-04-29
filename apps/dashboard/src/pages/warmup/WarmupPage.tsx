import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Tag,
  Progress,
  Space,
  Typography,
  Badge,
  Tooltip,
  Empty,
  message as antdMessage,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepForwardOutlined,
  ReloadOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { slotsApi, warmupApi } from '../../services/api';

const { Title, Text } = Typography;

type WarmupPhase = 0 | 1 | 2 | 3 | 4;

const PHASE_META: Record<WarmupPhase, { label: string; percent: number; color: string }> = {
  0: { label: 'P0 Init',           percent: 0,   color: '#bfbfbf' },
  1: { label: 'P1 Silent Observe', percent: 25,  color: '#69b1ff' },
  2: { label: 'P2 Lite Activity',  percent: 50,  color: '#4096ff' },
  3: { label: 'P3 Social Build',   percent: 75,  color: '#1677ff' },
  4: { label: 'P4 Normal Ops',     percent: 100, color: '#52c41a' },
};

interface ApiAccount {
  id: string;
  phoneNumber: string;
  role: 'cs' | 'ad' | 'hybrid';
  status: 'online' | 'offline' | 'connecting' | 'error' | 'banned';
  warmupPhase: number;
  healthScore: number;
  lastActiveAt: string | null;
  sessionEncrypted: boolean;
}

interface ApiSlot {
  id: string;
  no: number;
  status: 'vacant' | 'occupied' | 'released';
  account: ApiAccount | null;
}

interface WarmupPlan {
  id: string;
  accountId: string;
  currentPhase: number;
  phaseStartedAt: Record<string, string>;
  actionsLog: Array<{ phase: number; action: string; ts: string }>;
  completed: boolean;
  paused?: boolean;
  pausedAt?: string | null;
  createdAt: string;
}

interface Row {
  slot: ApiSlot;
  plan: WarmupPlan | null;
  loadingPlan: boolean;
}

function healthColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  if (score >= 30) return '#fa8c16';
  return '#f5222d';
}

export default function WarmupPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<Record<string, boolean>>({});

  const setBusy = (id: string, val: boolean) =>
    setBusyId(prev => ({ ...prev, [id]: val }));

  const fetchPlanFor = async (accountId: string): Promise<WarmupPlan | null> => {
    try {
      const res = await warmupApi.status(accountId);
      return res.data ?? null;
    } catch {
      return null;
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const slotsRes = await slotsApi.list();
      const slots: ApiSlot[] = Array.isArray(slotsRes.data) ? slotsRes.data : [];
      const occupied = slots.filter(s => s.status === 'occupied' && s.account);

      // Fetch each occupied account's warmup plan in parallel
      const plans = await Promise.all(
        occupied.map(async s => ({
          slot: s,
          plan: await fetchPlanFor(s.account!.id),
          loadingPlan: false,
        })),
      );
      setRows(plans);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load warmup status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleStart = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.start(row.slot.account.id);
      antdMessage.success(`Warmup started for No.${row.slot.no}`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Start failed');
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleAdvance = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.advance(row.slot.account.id);
      antdMessage.success(`Advanced to next phase`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Advance failed');
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handlePause = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.pause(row.slot.account.id);
      antdMessage.warning(`Warmup paused for No.${row.slot.no}`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Pause failed');
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleResume = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.resume(row.slot.account.id);
      antdMessage.success(`Warmup resumed for No.${row.slot.no}`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : 'Resume failed');
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const columns: ColumnsType<Row> = [
    {
      title: 'No.',
      key: 'no',
      width: 60,
      align: 'center',
      render: (_, r) => (
        <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {String(r.slot.no).padStart(2, '0')}
        </Text>
      ),
    },
    {
      title: 'Phone',
      key: 'phone',
      width: 160,
      render: (_, r) => (
        <Text code>{r.slot.account?.phoneNumber ?? '—'}</Text>
      ),
    },
    {
      title: 'Role',
      key: 'role',
      width: 80,
      render: (_, r) => {
        const role = r.slot.account?.role;
        if (!role) return null;
        return (
          <Tag color={role === 'cs' ? 'blue' : role === 'ad' ? 'green' : 'orange'}>
            {role.toUpperCase()}
          </Tag>
        );
      },
    },
    {
      title: 'Account State',
      key: 'state',
      width: 120,
      render: (_, r) => {
        const a = r.slot.account;
        if (!a) return null;
        const ok = a.status === 'online';
        return <Badge status={ok ? 'success' : 'default'} text={a.status} />;
      },
    },
    {
      title: 'Phase & Progress',
      key: 'phase',
      render: (_, r) => {
        if (!r.plan) {
          return <Text type="secondary">no warmup plan yet</Text>;
        }
        const phase = (r.plan.currentPhase as WarmupPhase) ?? 0;
        const meta = PHASE_META[phase] ?? PHASE_META[0];
        return (
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12 }}>{meta.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {meta.percent}%{r.plan.completed ? ' · done' : r.plan.paused ? ' · paused' : ''}
              </Text>
            </div>
            <Progress percent={meta.percent} strokeColor={meta.color} showInfo={false} size="small" />
          </div>
        );
      },
    },
    {
      title: 'Health',
      key: 'health',
      width: 80,
      align: 'center',
      render: (_, r) => {
        const score = r.slot.account?.healthScore ?? 0;
        return <Text style={{ color: healthColor(score), fontWeight: 600 }}>{score}</Text>;
      },
    },
    {
      title: 'Started',
      key: 'started',
      width: 130,
      render: (_, r) => {
        const ts = r.plan?.phaseStartedAt?.['0'];
        return ts ? dayjs(ts).format('MM-DD HH:mm') : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 240,
      render: (_, row) => {
        const id = row.slot.account?.id;
        if (!id) return null;
        const busy = !!busyId[id];

        if (!row.plan) {
          return (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={busy}
              onClick={() => handleStart(row)}
            >
              Start Warmup
            </Button>
          );
        }
        if (row.plan.completed) {
          return <Tag color="success">Completed</Tag>;
        }
        const phase = row.plan.currentPhase;
        const isPaused = !!row.plan.paused;
        return (
          <Space size={4}>
            {!isPaused && phase < 4 && (
              <Tooltip title={`Advance to P${phase + 1}`}>
                <Button
                  size="small"
                  icon={<StepForwardOutlined />}
                  loading={busy}
                  onClick={() => handleAdvance(row)}
                >
                  Advance
                </Button>
              </Tooltip>
            )}
            {isPaused ? (
              <Button
                size="small"
                type="primary"
                icon={<RedoOutlined />}
                loading={busy}
                onClick={() => handleResume(row)}
              >
                Resume
              </Button>
            ) : (
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                loading={busy}
                onClick={() => handlePause(row)}
              >
                Pause
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Warmup Dashboard</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            7-day progressive warmup: P0 Init → P1 Silent → P2 Lite → P3 Social → P4 Normal Ops
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
          Refresh
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Empty description="No occupied slots yet — bind an account first" />
      ) : (
        <Table
          columns={columns}
          dataSource={rows}
          rowKey={(r) => r.slot.id}
          loading={loading}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          size="middle"
        />
      )}
    </div>
  );
}
