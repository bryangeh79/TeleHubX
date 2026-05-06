import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Tag,
  Progress,
  Space,
  Typography,
  Tooltip,
  Empty,
  Popconfirm,
  Modal,
  Descriptions,
  Row,
  Col,
  Card,
  message as antdMessage,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepForwardOutlined,
  ReloadOutlined,
  RedoOutlined,
  StopOutlined,
  UnorderedListOutlined,
  LoadingOutlined,
  ScheduleOutlined,
  CopyOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  BulbOutlined,
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

interface PhaseCardMeta {
  num: number;
  label: string;
  days: string;
  desc: string;
  color: string;
}

function buildPhaseCards(t: (k: string) => string): PhaseCardMeta[] {
  return [
    { num: 0, label: t('wu.phase.0'), days: t('wu.phaseCard.0.days'), desc: t('wu.phaseCard.0.desc'), color: '#bfbfbf' },
    { num: 1, label: t('wu.phase.1'), days: t('wu.phaseCard.1.days'), desc: t('wu.phaseCard.1.desc'), color: '#722ed1' },
    { num: 2, label: t('wu.phase.2'), days: t('wu.phaseCard.2.days'), desc: t('wu.phaseCard.2.desc'), color: '#13c2c2' },
    { num: 3, label: t('wu.phase.3'), days: t('wu.phaseCard.3.days'), desc: t('wu.phaseCard.3.desc'), color: '#fa8c16' },
    { num: 4, label: t('wu.phase.4'), days: t('wu.phaseCard.4.days'), desc: t('wu.phaseCard.4.desc'), color: '#52c41a' },
  ];
}

function dayOfWeek(startedAt: string | null | undefined): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const days = Math.floor((now - start) / (24 * 3600 * 1000)) + 1;
  return Math.max(1, Math.min(7, days));
}

export default function WarmupPage() {
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<Record<string, boolean>>({});
  const [logTask, setLogTask] = useState<PresetWarmupTask | null>(null);
  const [logChildren, setLogChildren] = useState<any[]>([]);
  const [logLoading, setLogLoading] = useState(false);

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

  // 打开 logTask 时拉子任务; running/paused 时 5s 轮询
  useEffect(() => {
    if (!logTask) { setLogChildren([]); return; }
    const fetchChildren = async () => {
      setLogLoading(true);
      try {
        const r = await tasksApi.children(logTask.id);
        setLogChildren(Array.isArray(r.data) ? r.data : []);
      } catch {
        setLogChildren([]);
      } finally {
        setLogLoading(false);
      }
    };
    void fetchChildren();
    if (logTask.status === 'running' || logTask.status === 'paused') {
      const id = setInterval(fetchChildren, 5000);
      return () => clearInterval(id);
    }
  }, [logTask?.id, logTask?.status]);

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
      width: 180,
      render: (_, r) => {
        const phone = r.slot.account?.phoneNumber;
        if (!phone) return <Text type="secondary">—</Text>;
        return (
          <Space size={4}>
            <Text code style={{ fontSize: 14, fontWeight: 500 }}>{phone}</Text>
            <Tooltip title={t('common.copy')}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(phone).then(
                    () => antdMessage.success(t('common.copied') || 'Copied'),
                    () => antdMessage.error('Copy failed'),
                  );
                }}
              />
            </Tooltip>
          </Space>
        );
      },
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
        const isDone = r.plan?.completed || r.presetTask?.status === 'done';
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: ok ? '#52c41a' : '#bfbfbf' }} />
              <Text style={{ fontSize: 12 }}>{a.status}</Text>
            </div>
            {isDone && (
              <Tag color="success" style={{ marginTop: 2, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>
                {t('wu.tagDone')}
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: t('wu.col.phaseProgress'),
      key: 'phase',
      width: 280,
      render: (_, r) => {
        if (r.plan) {
          const phase = (r.plan.currentPhase as WarmupPhase) ?? 0;
          const meta = PHASE_META[phase] ?? PHASE_META[0];
          const start = r.plan.phaseStartedAt?.['0'];
          const day = dayOfWeek(start);
          return (
            <div style={{ minWidth: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12 }}>🌱 {meta.label} · Day {day}/7</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {meta.percent}%
                </Text>
              </div>
              <Progress percent={meta.percent} strokeColor={meta.color} showInfo={false} size="small" />
              {start && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {t('wu.startedAt', { time: dayjs(start).format('MM-DD HH:mm') })}
                  {r.plan.completed ? ` · ${t('wu.completed')}` : r.plan.paused ? ` · ${t('wu.paused')}` : ''}
                </Text>
              )}
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
          const day = dayOfWeek(tk.startedAt);
          const totalDays = tk.type === 'preset_full_14d' ? 14 : 7;
          // 颜色根据 progress 推断阶段
          const phaseIdx = tk.progress >= 90 ? 4 : tk.progress >= 70 ? 3 : tk.progress >= 40 ? 2 : tk.progress >= 15 ? 1 : 0;
          const phaseColor = (PHASE_META[phaseIdx as WarmupPhase] ?? PHASE_META[0]).color;
          return (
            <div style={{ minWidth: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12 }}>🌱 {tkLabel} · Day {day}/{totalDays}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{tk.progress}%</Text>
              </div>
              <Progress percent={tk.progress} strokeColor={phaseColor} showInfo={false} size="small" />
              {tk.startedAt && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {t('wu.startedAt', { time: dayjs(tk.startedAt).format('MM-DD HH:mm') })}
                  {tk.status === 'done' ? ` · ${t('wu.completed')}` : tk.status === 'paused' ? ` · ${t('wu.paused')}` : ''}
                </Text>
              )}
            </div>
          );
        }
        return (
          <div style={{ minWidth: 240 }}>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.notStarted')}</Text>
            </div>
            <Progress percent={0} showInfo={false} size="small" />
            <Text type="secondary" style={{ fontSize: 10 }}>{t('wu.readyToStart')}</Text>
          </div>
        );
      },
    },
    {
      title: t('wu.col.health'),
      key: 'health',
      width: 90,
      align: 'center',
      render: (_, r) => {
        const score = r.slot.account?.healthScore ?? 0;
        const c = healthColor(score);
        return (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40, height: 40,
            borderRadius: '50%',
            border: `2px solid ${c}`,
            color: c,
            fontWeight: 600,
            fontSize: 13,
          }}>{score}</div>
        );
      },
    },
    {
      title: t('wu.col.startedAt'),
      key: 'started',
      width: 130,
      render: (_, r) => {
        const ts = r.plan?.phaseStartedAt?.['0'] ?? r.presetTask?.startedAt;
        return ts ? <Text style={{ fontSize: 12 }}>{dayjs(ts).format('MM-DD HH:mm')}</Text> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('wu.col.actions'),
      key: 'actions',
      width: 280,
      render: (_, row) => {
        const id = row.slot.account?.id;
        if (!id) return null;
        const busy = !!busyId[id];

        if (!row.plan) {
          if (row.presetTask) {
            const tk = row.presetTask;
            const tkId = tk.id;
            const tkSeq = tk.seq ?? '';
            const logsBtn = (
              <Tooltip title={t('wu.btnViewPresetLogs')}>
                <Button
                  size="small"
                  icon={<UnorderedListOutlined />}
                  onClick={() => setLogTask(tk)}
                />
              </Tooltip>
            );
            // 终态: 状态 Tag + 查看日志按钮
            if (tk.status === 'done') {
              return (
                <Space size={4}>
                  <Tag color="success">{t('wu.tagDone')}</Tag>
                  {logsBtn}
                </Space>
              );
            }
            if (tk.status === 'failed') {
              return (
                <Space size={4}>
                  <Tag color="error">{t('wu.tagCancelled')}</Tag>
                  {logsBtn}
                </Space>
              );
            }
            // running / paused: 状态 Tag + 控制按钮组 + 查看日志
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
                {logsBtn}
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
          return (
            <Button size="small" disabled icon={<CheckCircleFilled style={{ color: '#52c41a' }} />}>
              {t('wu.tagDone')}
            </Button>
          );
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
                />
              </Tooltip>
            )}
            {isPaused ? (
              <Tooltip title={t('wu.btnResume')}>
                <Button
                  size="small"
                  type="primary"
                  icon={<RedoOutlined />}
                  loading={busy}
                  onClick={() => handleResume(row)}
                />
              </Tooltip>
            ) : (
              <Tooltip title={t('wu.btnPause')}>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<PauseCircleOutlined />}
                  loading={busy}
                  onClick={() => handlePause(row)}
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // ─── 统计 ─────────────────────────────────────────────────────────────
  const total = rows.length;
  const runningCount = rows.filter(r =>
    (r.presetTask && (r.presetTask.status === 'running' || r.presetTask.status === 'paused')) ||
    (r.plan && !r.plan.completed && !r.plan.paused)
  ).length;
  const doneCount = rows.filter(r =>
    (r.presetTask && r.presetTask.status === 'done') ||
    (r.plan && r.plan.completed)
  ).length;
  const notStartedCount = rows.filter(r => !r.plan && !r.presetTask).length;
  const pct = (n: number) => total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;

  const PHASE_CARDS = buildPhaseCards(t);

  return (
    <div>
      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>🌱 {t('nav.warmup')}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('wu.subtitle')}
          </Text>
        </div>
        <Space size={16}>
          <Space size={12} style={{ fontSize: 12 }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#52c41a', marginRight: 4 }} />{t('wu.legend.running')}</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1677ff', marginRight: 4 }} />{t('wu.legend.completed')}</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#bfbfbf', marginRight: 4 }} />{t('wu.legend.notStarted')}</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            {t('wu.refresh')}
          </Button>
        </Space>
      </div>

      {/* ─── 统计卡 ─── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bodyStyle={{ padding: 16 }}>
            <Space align="center">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e6f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TeamOutlined style={{ fontSize: 22, color: '#1677ff' }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.total')}</Text>
                <div><Text strong style={{ fontSize: 22 }}>{total}</Text> <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.unitAccount')}</Text></div>
                <Text type="secondary" style={{ fontSize: 11 }}>{t('wu.stat.totalManaged')}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bodyStyle={{ padding: 16 }}>
            <Space align="center">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f6ffed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ThunderboltOutlined style={{ fontSize: 22, color: '#52c41a' }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('common.running')}</Text>
                <div><Text strong style={{ fontSize: 22, color: '#52c41a' }}>{runningCount}</Text> <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.unitAccount')}</Text></div>
                <Text type="secondary" style={{ fontSize: 11 }}>{pct(runningCount)}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bodyStyle={{ padding: 16 }}>
            <Space align="center">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fff7e6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ClockCircleOutlined style={{ fontSize: 22, color: '#fa8c16' }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.notStarted')}</Text>
                <div><Text strong style={{ fontSize: 22, color: '#fa8c16' }}>{notStartedCount}</Text> <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.unitAccount')}</Text></div>
                <Text type="secondary" style={{ fontSize: 11 }}>{pct(notStartedCount)}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bodyStyle={{ padding: 16 }}>
            <Space align="center">
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e6f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircleOutlined style={{ fontSize: 22, color: '#1677ff' }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('common.completed')}</Text>
                <div><Text strong style={{ fontSize: 22, color: '#1677ff' }}>{doneCount}</Text> <Text type="secondary" style={{ fontSize: 12 }}>{t('wu.stat.unitAccount')}</Text></div>
                <Text type="secondary" style={{ fontSize: 11 }}>{pct(doneCount)}</Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ─── 主区: 左边阶段说明侧栏 + 右边表格 ─── */}
      <Row gutter={16}>
        <Col xs={24} md={6} lg={5}>
          <Card
            size="small"
            title={
              <Space size={6}>
                <span>{t('wu.phaseSection')}</span>
                <Tooltip title={t('wu.phaseSectionTip')}>
                  <Text type="secondary" style={{ cursor: 'help' }}>?</Text>
                </Tooltip>
              </Space>
            }
            bodyStyle={{ padding: 12 }}
          >
            {PHASE_CARDS.map((p, idx) => (
              <div key={p.num} style={{ display: 'flex', gap: 10, marginBottom: idx === PHASE_CARDS.length - 1 ? 0 : 14 }}>
                <div style={{
                  flexShrink: 0,
                  width: 22, height: 22, borderRadius: '50%',
                  background: p.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600,
                }}>{p.num}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>{p.days}</div>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </Card>
          <Card
            size="small"
            style={{ marginTop: 12, background: '#e6f4ff', borderColor: '#91caff' }}
            bodyStyle={{ padding: 12 }}
          >
            <Space align="start" size={8}>
              <BulbOutlined style={{ color: '#1677ff', fontSize: 16, marginTop: 2 }} />
              <div>
                <Text strong style={{ fontSize: 12 }}>{t('wu.tip.title')}</Text>
                <div style={{ fontSize: 11, color: '#595959', marginTop: 4 }}>
                  {t('wu.tip.line1')}<br />
                  {t('wu.tip.line2')}
                </div>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={18} lg={19}>
          {rows.length === 0 && !loading ? (
            <Card><Empty description={t('wu.empty')} /></Card>
          ) : (
            <Card size="small" bodyStyle={{ padding: 0 }}>
              <Table
                columns={columns}
                dataSource={rows}
                rowKey={(r) => r.slot.id}
                loading={loading}
                pagination={{ pageSize: 10, hideOnSinglePage: false }}
                size="middle"
                rowClassName={(r) =>
                  (r.plan?.completed || r.presetTask?.status === 'done') ? 'wu-row-done' : ''
                }
              />
            </Card>
          )}
        </Col>
      </Row>

      <style>{`
        .wu-row-done > td { background: #f6ffed !important; }
      `}</style>

      {/* preset 任务详情 / 子任务时间线 Modal */}
      <Modal
        title={
          <Space>
            <UnorderedListOutlined />
            <span>{t('wu.presetLogsTitle')}</span>
            {logTask && (logTask.status === 'running' || logTask.status === 'paused') && (
              <Tag color="processing" icon={<LoadingOutlined />}>5s</Tag>
            )}
          </Space>
        }
        open={!!logTask}
        onCancel={() => setLogTask(null)}
        footer={<Button onClick={() => setLogTask(null)}>{t('common.close')}</Button>}
        width={640}
        destroyOnClose
      >
        {logTask && (() => {
          const presetKey: Record<string, string> = {
            preset_warmup_7d: 'wu.preset.warmup_7d',
            preset_full_14d: 'wu.preset.full_14d',
            preset_rampup_7d: 'wu.preset.rampup_7d',
            preset_mature_ops: 'wu.preset.mature_ops',
          };
          const tkLabel = presetKey[logTask.type] ? t(presetKey[logTask.type]) : logTask.type;
          const statusColor =
            logTask.status === 'done' ? 'success'
            : logTask.status === 'failed' ? 'error'
            : logTask.status === 'paused' ? 'warning'
            : 'processing';
          const statusLabel =
            logTask.status === 'done' ? t('wu.tagDone')
            : logTask.status === 'failed' ? t('wu.tagCancelled')
            : logTask.status === 'paused' ? t('wu.tagPaused')
            : t('wu.tagRunning');
          const progStatus =
            logTask.status === 'failed' ? 'exception'
            : logTask.status === 'done' ? 'success'
            : 'active';
          return (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="ID">#{logTask.seq ?? logTask.id.slice(0, 6)}</Descriptions.Item>
              <Descriptions.Item label={t('common.type')}>
                <Tag color="blue">{tkLabel}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('common.status')}>
                <Tag color={statusColor as any}>
                  {logTask.status === 'running' ? <LoadingOutlined /> : null} {statusLabel}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('task.progress')}>
                <Progress percent={logTask.progress} size="small" status={progStatus as any} />
              </Descriptions.Item>
              {logTask.startedAt && (
                <Descriptions.Item label={t('task.startedAt')}>
                  {dayjs(logTask.startedAt).format('YYYY-MM-DD HH:mm:ss')}
                </Descriptions.Item>
              )}
            </Descriptions>
          );
        })()}

        {logTask && (
          <div style={{ marginTop: 16 }}>
            <Title level={5} style={{ marginBottom: 8 }}>
              <ScheduleOutlined style={{ marginRight: 6 }} />
              {t('wu.childProgress')} ({logChildren.filter((c) => c.status === 'done').length}/{logChildren.length})
            </Title>
            {logLoading && logChildren.length === 0 ? (
              <Text type="secondary">{t('common.loading') || '...'}</Text>
            ) : logChildren.length === 0 ? (
              <Empty description={t('wu.noChildren')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ maxHeight: 360, overflow: 'auto' }}>
                {logChildren.map((c: any) => {
                  const bg =
                    c.status === 'done' ? '#f6ffed'
                    : c.status === 'running' ? '#e6f7ff'
                    : c.status === 'failed' ? '#fff1f0'
                    : c.status === 'paused' ? '#fff7e6'
                    : '#fafafa';
                  const sColor =
                    c.status === 'done' ? 'success'
                    : c.status === 'running' ? 'processing'
                    : c.status === 'failed' ? 'error'
                    : c.status === 'paused' ? 'warning'
                    : 'default';
                  return (
                    <div key={c.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '6px 10px',
                      marginBottom: 4,
                      background: bg,
                      borderRadius: 4,
                      fontSize: 12,
                    }}>
                      <Tag color="default" style={{ fontSize: 11, marginRight: 8 }}>
                        {c.type}
                      </Tag>
                      <Text style={{ flex: 1, fontSize: 12 }}>{c.name}</Text>
                      <Text type="secondary" style={{ fontSize: 11, marginRight: 10 }}>
                        {c.scheduledAt ? dayjs(c.scheduledAt).format('MM-DD HH:mm') : '—'}
                      </Text>
                      <Tag color={sColor as any} style={{ fontSize: 10, margin: 0 }}>
                        {c.status === 'running' ? <LoadingOutlined /> : null} {c.status}
                      </Tag>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
