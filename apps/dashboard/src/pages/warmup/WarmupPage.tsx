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
  Popconfirm,
  message as antdMessage,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepForwardOutlined,
  ReloadOutlined,
  RedoOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { slotsApi, tasksApi, warmupApi } from '../../services/api';
import { useT } from '../../i18n';

const { Title, Text } = Typography;

type WarmupPhase = 0 | 1 | 2 | 3 | 4;

function buildPhaseMeta(t: (k: string) => string): Record<WarmupPhase, { label: string; percent: number; color: string }> {
  return {
    0: { label: t('wu.phase.0'), percent: 0,   color: '#bfbfbf' },
    1: { label: t('wu.phase.1'), percent: 25,  color: '#69b1ff' },
    2: { label: t('wu.phase.2'), percent: 50,  color: '#4096ff' },
    3: { label: t('wu.phase.3'), percent: 75,  color: '#1677ff' },
    4: { label: t('wu.phase.4'), percent: 100, color: '#52c41a' },
  };
}

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

/** 通过任务调度启动的 preset 养号任务（区别于旧 warmup_plans 的 P0-P4 渐进） */
interface PresetWarmupTask {
  id: string;
  seq: number | null;
  type: string; // preset_warmup_7d / preset_full_14d / preset_rampup_7d / preset_mature_ops
  status: string;
  progress: number;
  startedAt: string | null;
}

interface Row {
  slot: ApiSlot;
  plan: WarmupPlan | null;
  presetTask: PresetWarmupTask | null;
  loadingPlan: boolean;
}

function healthColor(score: number): string {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  if (score >= 30) return '#fa8c16';
  return '#f5222d';
}

export default function WarmupPage() {
  const t = useT();
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

      // 并行：legacy warmup plans + 通过任务调度启动的 preset 养号任务
      const [plansData, presetTasksData] = await Promise.all([
        Promise.all(
          occupied.map(async s => ({
            id: s.account!.id,
            plan: await fetchPlanFor(s.account!.id),
          })),
        ),
        // 拉所有 running + paused 状态的 preset_* 任务 (paused 也要展示, 才有"恢复"按钮)
        Promise.all([
          tasksApi.list({ status: 'running', type: 'preset_warmup_7d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'running', type: 'preset_full_14d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'running', type: 'preset_rampup_7d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'running', type: 'preset_mature_ops' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'paused',  type: 'preset_warmup_7d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'paused',  type: 'preset_full_14d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'paused',  type: 'preset_rampup_7d' }).catch(() => ({ data: [] })),
          tasksApi.list({ status: 'paused',  type: 'preset_mature_ops' }).catch(() => ({ data: [] })),
        ]).then(arr => arr.flatMap(r => (Array.isArray(r.data) ? r.data : []))),
      ]);

      const planByAccountId = new Map(plansData.map(p => [p.id, p.plan]));
      const presetByAccountId = new Map<string, PresetWarmupTask>();
      for (const tsk of presetTasksData) {
        if (tsk?.accountId && !presetByAccountId.has(tsk.accountId)) {
          presetByAccountId.set(tsk.accountId, {
            id: tsk.id, seq: tsk.seq, type: tsk.type, status: tsk.status,
            progress: tsk.progress ?? 0, startedAt: tsk.startedAt ?? null,
          });
        }
      }

      const rowsBuilt: Row[] = occupied.map(s => ({
        slot: s,
        plan: planByAccountId.get(s.account!.id) ?? null,
        presetTask: presetByAccountId.get(s.account!.id) ?? null,
        loadingPlan: false,
      }));
      setRows(rowsBuilt);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('wu.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleStart = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.start(row.slot.account.id);
      antdMessage.success(t('wu.startOk', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : t('wu.startFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleAdvance = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.advance(row.slot.account.id);
      antdMessage.success(t('wu.advanceOk'));
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : t('wu.advanceFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handlePause = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.pause(row.slot.account.id);
      antdMessage.warning(t('wu.pauseOk', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : t('wu.pauseFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleResume = async (row: Row) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await warmupApi.resume(row.slot.account.id);
      antdMessage.success(t('wu.resumeOk', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(typeof msg === 'string' ? msg : t('wu.resumeFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  // ─── preset (任务调度启动的养号) 控制: 调 tasksApi 的 pause/resume/cancel,
  //     server 端会级联到所有子任务. ─────────────────────────────────────────
  const handlePausePreset = async (row: Row, taskId: string) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await tasksApi.pause(taskId);
      antdMessage.warning(t('wu.presetPausedMsg', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('wu.pauseFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleResumePreset = async (row: Row, taskId: string) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await tasksApi.resume(taskId);
      antdMessage.success(t('wu.presetResumedMsg', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('wu.resumeFail'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const handleCancelPreset = async (row: Row, taskId: string) => {
    if (!row.slot.account) return;
    setBusy(row.slot.account.id, true);
    try {
      await tasksApi.cancel(taskId);
      antdMessage.success(t('wu.presetCancelledMsg', { no: row.slot.no }));
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    } finally {
      setBusy(row.slot.account.id, false);
    }
  };

  const PHASE_META = buildPhaseMeta(t);
  const columns: ColumnsType<Row> = [
    {
      title: t('wu.col.no'),
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
      title: t('wu.col.phone'),
      key: 'phone',
      width: 160,
      render: (_, r) => (
        <Text code>{r.slot.account?.phoneNumber ?? '—'}</Text>
      ),
    },
    {
      title: t('wu.col.role'),
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
      title: t('wu.col.acctStatus'),
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
      title: t('wu.col.phaseProgress'),
      key: 'phase',
      width: 240,
      render: (_, r) => {
        if (r.plan) {
          const phase = (r.plan.currentPhase as WarmupPhase) ?? 0;
          const meta = PHASE_META[phase] ?? PHASE_META[0];
          return (
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12 }}>{meta.label}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {meta.percent}%{r.plan.completed ? t('wu.completed') : r.plan.paused ? t('wu.paused') : ''}
                </Text>
              </div>
              <Progress percent={meta.percent} strokeColor={meta.color} showInfo={false} size="small" />
            </div>
          );
        }
        if (r.presetTask) {
          const tk = r.presetTask;
          const presetKey: Record<string, string> = {
            preset_warmup_7d: 'wu.preset.warmup_7d',
            preset_full_14d: 'wu.preset.full_14d',
            preset_rampup_7d: 'wu.preset.rampup_7d',
            preset_mature_ops: 'wu.preset.mature_ops',
          };
          const tkLabel = presetKey[tk.type] ? t(presetKey[tk.type]) : tk.type;
          return (
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12 }}>{tkLabel} · #{tk.seq}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{tk.progress}%</Text>
              </div>
              <Progress percent={tk.progress} strokeColor="#1677ff" showInfo={false} size="small" />
              {tk.startedAt && (
                <Text type="secondary" style={{ fontSize: 10 }}>{t('wu.startedAt', { time: dayjs(tk.startedAt).format('MM-DD HH:mm') })}</Text>
              )}
            </div>
          );
        }
        return <Text type="secondary">{t('wu.notStarted')}</Text>;
      },
    },
    {
      title: t('wu.col.health'),
      key: 'health',
      width: 80,
      align: 'center',
      render: (_, r) => {
        const score = r.slot.account?.healthScore ?? 0;
        return <Text style={{ color: healthColor(score), fontWeight: 600 }}>{score}</Text>;
      },
    },
    {
      title: t('wu.col.startedAt'),
      key: 'started',
      width: 130,
      render: (_, r) => {
        const ts = r.plan?.phaseStartedAt?.['0'];
        return ts ? dayjs(ts).format('MM-DD HH:mm') : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('wu.col.actions'),
      key: 'actions',
      width: 240,
      render: (_, row) => {
        const id = row.slot.account?.id;
        if (!id) return null;
        const busy = !!busyId[id];

        if (!row.plan) {
          if (row.presetTask) {
            const tk = row.presetTask;
            const tkId = tk.id;
            const tkSeq = tk.seq ?? '';
            // 终态: 不显示按钮, 只显示状态 Tag
            if (tk.status === 'done') {
              return <Tag color="success">{t('wu.tagDone')}</Tag>;
            }
            if (tk.status === 'failed') {
              return <Tag color="error">{t('wu.tagCancelled')}</Tag>;
            }
            // running / paused: 状态 Tag + 控制按钮组
            const isPaused = tk.status === 'paused';
            return (
              <Space size={4}>
                <Tooltip title={t('wu.runningPresetTip', { seq: tkSeq })}>
                  <Tag color={isPaused ? 'orange' : 'processing'}>
                    {isPaused ? t('wu.tagPaused') : t('wu.tagRunning')}
                  </Tag>
                </Tooltip>
                {isPaused ? (
                  <Tooltip title={t('wu.btnResumePreset')}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      loading={busy}
                      onClick={() => handleResumePreset(row, tkId)}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip title={t('wu.btnPausePreset')}>
                    <Button
                      size="small"
                      icon={<PauseCircleOutlined />}
                      loading={busy}
                      onClick={() => handlePausePreset(row, tkId)}
                    />
                  </Tooltip>
                )}
                <Popconfirm
                  title={t('wu.cancelPresetConfirm')}
                  description={t('wu.cancelPresetDesc')}
                  okType="danger"
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => handleCancelPreset(row, tkId)}
                >
                  <Tooltip title={t('wu.btnCancelPreset')}>
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={busy}
                    />
                  </Tooltip>
                </Popconfirm>
              </Space>
            );
          }
          return (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={busy}
              onClick={() => handleStart(row)}
            >
              {t('wu.btnStart')}
            </Button>
          );
        }
        if (row.plan.completed) {
          return <Tag color="success">{t('wu.tagDone')}</Tag>;
        }
        const phase = row.plan.currentPhase;
        const isPaused = !!row.plan.paused;
        return (
          <Space size={4}>
            {!isPaused && phase < 4 && (
              <Tooltip title={t('wu.advanceTip', { phase: phase + 1 })}>
                <Button
                  size="small"
                  icon={<StepForwardOutlined />}
                  loading={busy}
                  onClick={() => handleAdvance(row)}
                >
                  {t('wu.btnAdvance')}
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
                {t('wu.btnResume')}
              </Button>
            ) : (
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                loading={busy}
                onClick={() => handlePause(row)}
              >
                {t('wu.btnPause')}
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
          <Title level={4} style={{ margin: 0 }}>{t('nav.warmup')}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('wu.subtitle')}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
          {t('wu.refresh')}
        </Button>
      </div>

      {rows.length === 0 && !loading ? (
        <Empty description={t('wu.empty')} />
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
