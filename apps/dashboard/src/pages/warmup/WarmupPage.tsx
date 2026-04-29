import { useState } from 'react';
import {
  Table,
  Button,
  Tag,
  Progress,
  Space,
  Typography,
  Badge,
  Tooltip,
  message,
} from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { warmupApi } from '../../services/api';

const { Title, Text } = Typography;

type WarmupPhase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
type WarmupStatus = 'idle' | 'running' | 'paused' | 'completed';

interface WarmupAccount {
  id: string;
  phone: string;
  role: 'cs' | 'ad' | 'hybrid';
  warmupPhase: WarmupPhase;
  warmupStatus: WarmupStatus;
  healthScore: number;
  startedAt: string | null;
  updatedAt: string;
}

const PHASE_META: Record<WarmupPhase, { label: string; percent: number; color: string }> = {
  P0: { label: 'P0 Init',            percent: 0,   color: '#bfbfbf' },
  P1: { label: 'P1 Silent Observe',  percent: 25,  color: '#69b1ff' },
  P2: { label: 'P2 Lite Activity',   percent: 50,  color: '#4096ff' },
  P3: { label: 'P3 Social Build',    percent: 75,  color: '#1677ff' },
  P4: { label: 'P4 Normal Ops',      percent: 100, color: '#52c41a' },
};

const STATUS_BADGE: Record<WarmupStatus, 'default' | 'processing' | 'warning' | 'success'> = {
  idle:      'default',
  running:   'processing',
  paused:    'warning',
  completed: 'success',
};

const MOCK: WarmupAccount[] = [
  { id: '1', phone: '+60123456789', role: 'ad', warmupPhase: 'P4', warmupStatus: 'completed', healthScore: 92, startedAt: '2026-04-22T10:00:00Z', updatedAt: '2026-04-29T10:00:00Z' },
  { id: '2', phone: '+60198765432', role: 'ad', warmupPhase: 'P2', warmupStatus: 'running',   healthScore: 61, startedAt: '2026-04-27T08:00:00Z', updatedAt: '2026-04-30T06:00:00Z' },
  { id: '3', phone: '+60111234567', role: 'cs', warmupPhase: 'P1', warmupStatus: 'paused',    healthScore: 45, startedAt: '2026-04-28T09:00:00Z', updatedAt: '2026-04-29T14:00:00Z' },
  { id: '4', phone: '+60177654321', role: 'ad', warmupPhase: 'P3', warmupStatus: 'running',   healthScore: 78, startedAt: '2026-04-25T07:00:00Z', updatedAt: '2026-04-30T05:00:00Z' },
  { id: '5', phone: '+60133219876', role: 'cs', warmupPhase: 'P0', warmupStatus: 'idle',      healthScore: 10, startedAt: null,                   updatedAt: '2026-04-30T00:00:00Z' },
];

function healthColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  if (score >= 30) return '#fa8c16';
  return '#f5222d';
}

export default function WarmupPage() {
  const [accounts, setAccounts] = useState<WarmupAccount[]>(MOCK);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const setRowLoading = (id: string, val: boolean) =>
    setLoading(prev => ({ ...prev, [id]: val }));

  const handleStart = async (id: string) => {
    setRowLoading(id, true);
    try {
      await warmupApi.start(id);
      setAccounts(prev =>
        prev.map(a => a.id === id ? { ...a, warmupStatus: 'running' } : a)
      );
      message.success('Warmup started');
    } catch {
      setAccounts(prev =>
        prev.map(a => a.id === id ? { ...a, warmupStatus: 'running' } : a)
      );
      message.success('Warmup started (mock)');
    } finally {
      setRowLoading(id, false);
    }
  };

  const handlePause = async (id: string) => {
    setRowLoading(id, true);
    try {
      await warmupApi.pause(id);
      setAccounts(prev =>
        prev.map(a => a.id === id ? { ...a, warmupStatus: 'paused' } : a)
      );
      message.warning('Warmup paused');
    } catch {
      setAccounts(prev =>
        prev.map(a => a.id === id ? { ...a, warmupStatus: 'paused' } : a)
      );
      message.warning('Warmup paused (mock)');
    } finally {
      setRowLoading(id, false);
    }
  };

  const columns: ColumnsType<WarmupAccount> = [
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 160,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 80,
      render: (role: string) => (
        <Tag color={role === 'cs' ? 'blue' : role === 'ad' ? 'green' : 'orange'}>
          {role.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'warmupStatus',
      key: 'warmupStatus',
      width: 120,
      render: (s: WarmupStatus) => (
        <Badge status={STATUS_BADGE[s]} text={s} />
      ),
    },
    {
      title: 'Phase & Progress',
      key: 'phase',
      render: (_, record) => {
        const meta = PHASE_META[record.warmupPhase];
        return (
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12 }}>{meta.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{meta.percent}%</Text>
            </div>
            <Progress
              percent={meta.percent}
              strokeColor={meta.color}
              showInfo={false}
              size="small"
            />
          </div>
        );
      },
    },
    {
      title: 'Health Score',
      dataIndex: 'healthScore',
      key: 'healthScore',
      width: 140,
      render: (score: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            type="circle"
            percent={score}
            size={40}
            strokeColor={healthColor(score)}
            format={p => <span style={{ fontSize: 11, color: healthColor(score) }}>{p}</span>}
          />
        </div>
      ),
    },
    {
      title: 'Started',
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 140,
      render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      render: (_, record) => {
        const busy = loading[record.id];
        const canStart = record.warmupStatus === 'idle' || record.warmupStatus === 'paused';
        const canPause = record.warmupStatus === 'running';
        return (
          <Space>
            {canStart && (
              <Tooltip title="Start warmup">
                <Button
                  size="small"
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={busy}
                  onClick={() => handleStart(record.id)}
                >
                  Start
                </Button>
              </Tooltip>
            )}
            {canPause && (
              <Tooltip title="Pause warmup">
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  loading={busy}
                  onClick={() => handlePause(record.id)}
                >
                  Pause
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Warmup Dashboard</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          7-day progressive warmup: P0 Init → P1 Silent → P2 Lite → P3 Social → P4 Normal Ops
        </Text>
      </div>

      <Table
        columns={columns}
        dataSource={accounts}
        rowKey="id"
        pagination={false}
        size="middle"
      />
    </div>
  );
}
