import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DeleteOutlined,
  EyeOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { accountsApi, assetsApi, chatScriptsApi, leadCandidatesApi, slotsApi, tasksApi } from '../../services/api';
import { resolveErrorClassMeta } from '../../utils/error-class';
import { useT } from '../../i18n';

const { Title, Text } = Typography;

type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'paused';
type TaskType =
  // 组合配套
  | 'preset_full_14d' | 'preset_warmup_7d' | 'preset_rampup_7d' | 'preset_mature_ops'
  // 群组发现+加入
  | 'join_groups' | 'join_groups_by_keyword' | 'discover_groups_by_keyword' | 'join_channels' | 'accept_invites'
  // 自建群
  | 'group_create' | 'group_invite_members'
  // 群组活动
  | 'group_bubble' | 'chat_script_ab' | 'chat_script_4p' | 'chat_script_6p'
  // 拉新
  | 'keyword_lead_hunt' | 'group_scrape'
  // 触达
  | 'contact_add' | 'campaign_single'
  // 内容
  | 'post_channel' | 'media_voice' | 'media_photo' | 'media_video'
  // 互动/保活
  | 'reaction_boost' | 'browse_channel' | 'profile_update' | 'idle_keepalive';

interface Task {
  id: string;
  seq?: number | string | null;
  tenantId: string | null;
  name: string;
  type: TaskType;
  status: TaskStatus;
  accountId: string | null;
  accountLabel: string | null;
  payload: Record<string, any> | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: number;
  errorMsg: string | null;
  /** Auto-Recovery 系统: 错误分类码 A/B/D/E/F/G/H */
  errorClass?: string | null;
  /** Auto-Recovery 系统: 已自动重试次数 */
  autoRetryCount?: number;
  /** Auto-Recovery 系统: 上次自动重试时间 */
  lastRetryAt?: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  pending: number;
  running: number;
  failed: number;
  done: number;
}

interface TaskTypeMeta { label: string; color: string; group: string; icon: string }

/**
 * Round-9: TASK_TYPE_LABELS labels 改英文 fallback (zh-only 字符串太多, 默认 English).
 * 渲染走 taskTypeLabel(t, type) — 优先 i18n key (taskType.<key>), 缺失时 fallback 到 .label.
 * group/icon/color 静态保留 (group 仅用于 grouped Select).
 */
const TASK_TYPE_LABELS: Record<TaskType, TaskTypeMeta> = {
  // Preset bundles
  preset_full_14d:        { icon: '🎯', label: 'Full Preset 14 days',     color: 'gold',     group: 'Preset' },
  preset_warmup_7d:       { icon: '🌱', label: 'Warmup 7 days',           color: 'lime',     group: 'Preset' },
  preset_rampup_7d:       { icon: '🔥', label: 'Rampup 7 days',           color: 'orange',   group: 'Preset' },
  preset_mature_ops:      { icon: '🚀', label: 'Mature Ops Day 15+',      color: 'volcano',  group: 'Preset' },

  // Group discovery + join
  join_groups:            { icon: '🌐', label: 'Join Groups',             color: 'green',    group: 'Groups' },
  join_groups_by_keyword: { icon: '🔍', label: 'Search & Join Groups',    color: 'green',    group: 'Groups' },
  discover_groups_by_keyword: { icon: '🔭', label: 'Discover Groups',     color: 'cyan',     group: 'Groups' },
  join_channels:          { icon: '⭐', label: 'Follow Channels',         color: 'cyan',     group: 'Groups' },
  accept_invites:         { icon: '👥', label: 'Accept Invites',          color: 'green',    group: 'Groups' },

  // Self-built group
  group_create:           { icon: '🏗️', label: 'Create Group',            color: 'purple',   group: 'Groups (Self)' },
  group_invite_members:   { icon: '📨', label: 'Invite Members',          color: 'purple',   group: 'Groups (Self)' },

  // Group activity
  group_bubble:           { icon: '💡', label: 'Group Bubble',            color: 'gold',     group: 'Group Activity' },
  chat_script_ab:         { icon: '💬', label: 'Chat Script A+B',         color: 'purple',   group: 'Group Activity' },
  chat_script_4p:         { icon: '💬', label: 'Chat Script 4-person',    color: 'purple',   group: 'Group Activity' },
  chat_script_6p:         { icon: '💬', label: 'Chat Script 6-person',    color: 'purple',   group: 'Group Activity' },

  // Lead generation
  keyword_lead_hunt:      { icon: '🎯', label: 'Keyword Lead Hunt',       color: 'magenta',  group: 'Lead Hunt' },
  group_scrape:           { icon: '🎯', label: 'Group Scrape',            color: 'magenta',  group: 'Lead Hunt' },

  // Outreach
  contact_add:            { icon: '➕', label: 'Add Contact',             color: 'blue',     group: 'Outreach' },
  campaign_single:        { icon: '📝', label: 'Campaign Single',         color: 'cyan',     group: 'Outreach' },

  // Content
  post_channel:           { icon: '📢', label: 'Post Channel / Story',    color: 'blue',     group: 'Content' },
  media_voice:            { icon: '🎤', label: 'Media: Voice',            color: 'blue',     group: 'Content' },
  media_photo:            { icon: '🖼️', label: 'Media: Photo',            color: 'blue',     group: 'Content' },
  media_video:            { icon: '🎬', label: 'Media: Video',            color: 'blue',     group: 'Content' },

  // Interaction / Keep-alive
  reaction_boost:         { icon: '👍', label: 'Reaction Boost',          color: 'magenta',  group: 'Interaction' },
  browse_channel:         { icon: '🌐', label: 'Browse Channel',          color: 'default',  group: 'Interaction' },
  profile_update:         { icon: '📋', label: 'Profile Update',          color: 'default',  group: 'Interaction' },
  idle_keepalive:         { icon: '🔌', label: 'Idle Keep-alive',         color: 'default',  group: 'Interaction' },
};

/** Resolve task type label via i18n (taskType.<key>); fallback to TASK_TYPE_LABELS.label */
function taskTypeLabel(t: (k: string) => string, type: string): string {
  const key = `taskType.${type}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  return (TASK_TYPE_LABELS as any)[type]?.label ?? type;
}

/** 把 22 个任务按 group 分组成 antd Select 的 options（带 emoji）。 */
function buildGroupedTaskOptions() {
  const grouped: Record<string, Array<{ value: string; label: string }>> = {};
  // campaign_single 是「广告投放」自动产生的子任务，不在通用调度里展示/创建
  const HIDDEN_TYPES = new Set(['campaign_single']);
  for (const [k, m] of Object.entries(TASK_TYPE_LABELS)) {
    if (HIDDEN_TYPES.has(k)) continue;
    if (!grouped[m.group]) grouped[m.group] = [];
    grouped[m.group].push({ value: k, label: `${m.icon}  ${m.label}` });
  }
  // 保持 group 顺序：按首次出现顺序（Object.entries 在 Node 14+ 稳定按插入顺序）
  return Object.entries(grouped).map(([groupName, items]) => ({
    label: groupName,
    options: items,
  }));
}

/** 颜色 static, label 通过 statusMeta(t) 函数取 4 语. */
const STATUS_COLOR: Record<TaskStatus, string> = {
  pending:  'default',
  running:  'processing',
  done:     'success',
  failed:   'error',
  paused:   'warning',
};
function statusMeta(t: (k: string) => string): Record<TaskStatus, { label: string; color: string }> {
  return {
    pending:  { label: t('page.scheduler.status.pending'), color: STATUS_COLOR.pending },
    running:  { label: t('page.scheduler.status.running'), color: STATUS_COLOR.running },
    done:     { label: t('page.scheduler.status.done'),    color: STATUS_COLOR.done },
    failed:   { label: t('page.scheduler.status.failed'),  color: STATUS_COLOR.failed },
    paused:   { label: t('page.scheduler.status.paused'),  color: STATUS_COLOR.paused },
  };
}
/** Backward compat: zh fallback for code paths that still reference STATUS_META. */
const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  pending:  { label: '待运行', color: 'default' },
  running:  { label: '运行中', color: 'processing' },
  done:     { label: '已完成', color: 'success' },
  failed:   { label: '失败',   color: 'error' },
  paused:   { label: '已暂停', color: 'warning' },
};

export default function SchedulerPage() {
  const t = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, running: 0, failed: 0, done: 0 });
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | undefined>();
  const [filterType, setFilterType] = useState<TaskType | undefined>();

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 账号选项 (供新建任务时下拉选择)
  const [accountOptions, setAccountOptions] = useState<Array<{ value: string; label: React.ReactNode; phone: string }>>([]);
  // accountId -> slotNo 映射 (任务表 "目标" 列用)
  const [accountSlotMap, setAccountSlotMap] = useState<Map<string, number>>(new Map());

  // 「立即执行」开关
  const [runNow, setRunNow] = useState(true);

  // 任务详情/日志查看
  const [logTask, setLogTask] = useState<Task | null>(null);
  const [logChildren, setLogChildren] = useState<Task[]>([]);
  const [logHuntCount, setLogHuntCount] = useState<number>(0);
  const [logHuntSources, setLogHuntSources] = useState<Array<{ sourceGroupId: string | null; sourceGroupTitle: string | null; count: number }>>([]);

  // 自动刷新计时器
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 剧本列表（仅在创建 chat_script 类任务时加载）
  const [scriptOptions, setScriptOptions] = useState<Array<{ value: string; label: string; type: string; category: string | null }>>([]);
  const [scriptPacks, setScriptPacks] = useState<Array<{ packId: string; count: number; types: string[] }>>([]);

  // 素材列表 (媒体类任务用) — 按 category 加载, 含 builtin
  const [assetPools, setAssetPools] = useState<Array<{ poolName: string; category: string; count: number }>>([]);
  const [assetOptions, setAssetOptions] = useState<Array<{ value: string; label: string; category: string }>>([]);

  const loadAccounts = useCallback(async () => {
    try {
      const slotsRes = await slotsApi.list();
      const slots: any[] = Array.isArray(slotsRes.data) ? slotsRes.data : [];
      const slotMap = new Map<string, number>();
      const opts: any[] = [];
      for (const s of slots) {
        if (s.status === 'occupied' && s.account) {
          slotMap.set(s.account.id, s.no);
          opts.push({
            value: s.account.id,
            phone: s.account.phoneNumber,
            label: (
              <Space size={6}>
                <Text strong>#{String(s.no).padStart(2, '0')}</Text>
                <Text>{s.account.phoneNumber}</Text>
                <Tag color={s.account.role === 'cs' ? 'blue' : s.account.role === 'ad' ? 'green' : 'orange'} style={{ fontSize: 10 }}>
                  {s.account.role.toUpperCase()}
                </Tag>
                <Tag color={s.account.status === 'online' ? 'green' : 'default'} style={{ fontSize: 10 }}>
                  {s.account.status === 'online' ? '在线' : s.account.status}
                </Tag>
              </Space>
            ),
          });
        }
      }
      setAccountOptions(opts);
      setAccountSlotMap(slotMap);
    } catch {
      // ignore
    }
  }, []);
  const [form] = Form.useForm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, statsRes] = await Promise.all([
        tasksApi.list({ status: filterStatus, type: filterType }),
        tasksApi.stats(),
      ]);
      // 过滤掉广告投放产生的 campaign_single 任务（在「广告投放」页面单独管理）
      const all = Array.isArray(tasksRes.data) ? tasksRes.data : [];
      setTasks(all.filter((t: any) => t.type !== 'campaign_single'));
      setStats(statsRes.data ?? { total: 0, pending: 0, running: 0, failed: 0, done: 0 });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterType]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  // 打开新建 modal 时懒加载剧本 + 素材池
  useEffect(() => {
    if (!createOpen) return;
    (async () => {
      try {
        const [scriptsRes, packsRes, poolsRes] = await Promise.all([
          chatScriptsApi.list({ status: 'active' }),
          chatScriptsApi.listPacks(),
          assetsApi.pools(),
        ]);
        const arr = Array.isArray(scriptsRes.data) ? scriptsRes.data : [];
        setScriptOptions(arr.map((s: any) => ({
          value: s.id,
          label: `${s.name} (${s.type}, ${s.maxRound}回合)`,
          type: s.type,
          category: s.category,
        })));
        setScriptPacks(Array.isArray(packsRes.data) ? packsRes.data : []);
        setAssetPools(Array.isArray(poolsRes.data) ? poolsRes.data : []);
      } catch {
        // ignore
      }
    })();
  }, [createOpen]);

  // 按 category 加载素材列表 (用户选了"指定素材"时)
  const loadAssetsByCategory = useCallback(async (category: string) => {
    try {
      // 同时拉 tenant 自己的 + builtin 共享池
      const [tenantRes, builtinRes] = await Promise.all([
        assetsApi.list({ category }),
        assetsApi.list({ category, source: 'builtin' }),
      ]);
      const merged = [
        ...(Array.isArray(tenantRes.data) ? tenantRes.data : []),
        ...(Array.isArray(builtinRes.data) ? builtinRes.data : []),
      ];
      setAssetOptions(merged.map((a: any) => ({
        value: a.id,
        label: `${a.fileName}${a.poolName ? ` [${a.poolName.replace('_builtin_', '')}]` : ''}`,
        category: a.category,
      })));
    } catch {
      setAssetOptions([]);
    }
  }, []);

  // 自动刷新：有 running/pending 任务时每 5s 刷一次列表
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === 'running' || t.status === 'pending');
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (hasActive) {
      autoRefreshRef.current = setInterval(() => void reload(), 5000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [tasks, reload]);

  // 也实时刷 logTask 详情（如果打开的话）
  useEffect(() => {
    if (!logTask) return;
    if (logTask.status !== 'running' && logTask.status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const fresh = (await tasksApi.get(logTask.id)).data;
        if (fresh) setLogTask(fresh);
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [logTask?.id, logTask?.status]);

  // 打开父任务时, 拉子任务列表 + (keyword_lead_hunt 额外拉候选人统计)
  useEffect(() => {
    if (!logTask) { setLogChildren([]); setLogHuntCount(0); setLogHuntSources([]); return; }
    const isPreset = (logTask.type as string).startsWith('preset_');
    const isHunt = logTask.type === 'keyword_lead_hunt';
    if (!isPreset && !isHunt) { setLogChildren([]); setLogHuntCount(0); setLogHuntSources([]); return; }
    (async () => {
      try {
        const childrenRes = await tasksApi.children(logTask.id);
        setLogChildren(Array.isArray(childrenRes.data) ? childrenRes.data : []);
        if (isHunt) {
          const stored = localStorage.getItem('telehubx:tenantId');
          const tenantId = stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : undefined;
          const [listRes, srcRes] = await Promise.all([
            leadCandidatesApi.list(tenantId ? { tenantId, huntTaskId: logTask.id } : { huntTaskId: logTask.id }),
            leadCandidatesApi.huntSources(logTask.id),
          ]);
          const list = Array.isArray(listRes.data) ? listRes.data.filter((c: any) => c.huntTaskId === logTask.id) : [];
          setLogHuntCount(list.length);
          setLogHuntSources(Array.isArray(srcRes.data) ? srcRes.data : []);
        }
      } catch {
        setLogChildren([]);
      }
    })();
  }, [logTask?.id, logTask?.status]);

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      const scheduledAt = runNow ? new Date().toISOString() : values.scheduledAt.toISOString();

      // chat_script_ab / 4p / 6p
      if (
        values.type === 'chat_script_ab' ||
        values.type === 'chat_script_4p' ||
        values.type === 'chat_script_6p'
      ) {
        const chatMode = values.chatMode ?? 'private';
        const payload: any = {
          chatMode,
          accountAId: values.accountAId,
          accountBId: values.accountBId,
          aiOptimize: values.aiOptimize ?? false,
        };
        if (chatMode === 'group') payload.tgChatId = values.tgChatId;
        if (values.type === 'chat_script_4p' || values.type === 'chat_script_6p') {
          payload.accountCId = values.accountCId;
          payload.accountDId = values.accountDId;
        }
        if (values.type === 'chat_script_6p') {
          payload.accountEId = values.accountEId;
          payload.accountFId = values.accountFId;
        }
        if (values.scriptId) payload.scriptId = values.scriptId;
        else if (values.packId) payload.packId = values.packId;

        // accountId 字段对 chat_script 不重要（每个子任务自己 set），用 A 占位
        await tasksApi.create({
          name: values.name,
          type: values.type,
          accountId: values.accountAId,
          accountLabel: accountOptions.find((o) => o.value === values.accountAId)?.phone,
          scheduledAt,
          payload,
        } as any);
        const nLabel = values.type === 'chat_script_6p' ? '6 个'
          : values.type === 'chat_script_4p' ? '4 个' : '2 个';
        antdMessage.success(`已创建剧本任务（${nLabel}账号）`);
      } else if (
        values.type === 'media_photo' || values.type === 'media_video' ||
        values.type === 'media_voice' || values.type === 'post_channel'
      ) {
        // 媒体类任务: 接收方 (内池号 / 外部) + 素材 (随机 / 指定) + caption
        const picked = accountOptions.find((o) => o.value === values.accountId);
        const payload: any = {};
        if (values.targetMode === 'own') {
          payload.targetAccountId = values.targetAccountId;
          // server 自动注入 targetId = phoneNumber
        } else {
          payload.targetId = values.targetExternal;
        }
        if (values.assetMode === 'specific') {
          payload.assetId = values.assetId;
        } else {
          if (values.poolName) payload.poolName = values.poolName;
        }
        if (values.caption) payload.caption = values.caption;

        await tasksApi.create({
          name: values.name,
          type: values.type,
          accountId: values.accountId,
          accountLabel: picked?.phone,
          scheduledAt,
          payload,
        } as any);
        antdMessage.success(runNow ? '任务已创建并立即排队执行' : '任务已创建');
      } else {
        // 通用路径: 各种任务按类型构建 payload
        const picked = accountOptions.find((o) => o.value === values.accountId);
        const payload = buildPayloadForTaskType(values.type, values);
        await tasksApi.create({
          name: values.name,
          type: values.type,
          accountId: values.accountId,
          accountLabel: picked?.phone,
          scheduledAt,
          payload,
        } as any);
        antdMessage.success(runNow ? '任务已创建并立即排队执行' : '任务已创建');
      }
      setCreateOpen(false);
      form.resetFields();
      setRunNow(true);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async (id: string) => {
    try {
      await tasksApi.pause(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleResume = async (id: string) => {
    try {
      await tasksApi.resume(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await tasksApi.retry(id);
      antdMessage.success('已重新排入队列');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      await tasksApi.runNow(id);
      antdMessage.success('已克隆任务并立即排队执行');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await tasksApi.reactivate(id);
      antdMessage.success('已重新激活，子任务会按原计划继续');
      // 同步刷新当前打开的任务详情
      try {
        const fresh = (await tasksApi.get(id)).data;
        if (fresh) setLogTask(fresh);
      } catch {}
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await tasksApi.cancel(id);
      antdMessage.success('任务已强制停止');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleCancelAll = async () => {
    try {
      const res = await tasksApi.cancelAll();
      antdMessage.success(`已强制停止 ${res.data?.cancelled ?? 0} 个任务`);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.opFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tasksApi.delete(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const STATUS_META_T = statusMeta(t);
  const columns: ColumnsType<Task> = [
    {
      title: t('page.scheduler.col.id'), key: 'shortId', width: 80,
      render: (_, row) => (
        <Text code>#{row.seq ?? row.id.slice(0, 6)}</Text>
      ),
    },
    {
      title: t('page.scheduler.col.type'), key: 'type', width: 200,
      render: (_, row) => {
        const m = TASK_TYPE_LABELS[row.type];
        return (
          <Tag color={m?.color ?? 'default'} style={{ fontSize: 12, padding: '2px 8px' }}>
            {m?.icon ?? ''} {taskTypeLabel(t, row.type)}
          </Tag>
        );
      },
    },
    {
      title: t('page.scheduler.col.target'), key: 'target', width: 280,
      render: (_, row) => {
        // chat_script_ab/4p: 显示 A/B/C/D 多账号
        const p = row.payload as any;
        if (p && (p.accountAId || p.accountBId)) {
          const renderRole = (label: string, accId?: string) => {
            if (!accId) return null;
            const slotNo = accountSlotMap.get(accId);
            const opt = accountOptions.find((o) => o.value === accId);
            const phone = opt?.phone ?? accId.slice(0, 6);
            return (
              <Tag key={label} color="blue" style={{ fontSize: 11, padding: '2px 6px', marginBottom: 2 }}>
                {label}: {slotNo != null ? `#${String(slotNo).padStart(2, '0')} · ` : ''}{phone}
              </Tag>
            );
          };
          return (
            <div>
              {renderRole('A', p.accountAId)}
              {renderRole('B', p.accountBId)}
              {renderRole('C', p.accountCId)}
              {renderRole('D', p.accountDId)}
            </div>
          );
        }
        if (!row.accountId) return <Text type="secondary">—</Text>;
        const slotNo = accountSlotMap.get(row.accountId);
        const phone = row.accountLabel ?? '';
        return (
          <Tag color="blue" style={{ fontSize: 12, padding: '2px 8px' }}>
            {slotNo != null ? `#${String(slotNo).padStart(2, '0')} · ` : ''}{phone}
          </Tag>
        );
      },
    },
    {
      title: t('page.scheduler.col.status'), key: 'status', width: 150,
      render: (_, row) => {
        const m = STATUS_META_T[row.status];
        // 多天父任务: preset_* / keyword_lead_hunt — 永远显示进度条 (即使 0%)
        const isOrchestrator = (row.type as string).startsWith('preset_') || row.type === 'keyword_lead_hunt';

        if (row.status === 'running' || row.status === 'paused' || (isOrchestrator && row.status === 'pending')) {
          return (
            <div>
              <Progress percent={row.progress ?? 0} size="small"
                status={row.status === 'paused' ? 'normal' : row.status === 'pending' ? 'normal' : 'active'} />
              <Tag color={m.color as any} style={{ fontSize: 10, marginTop: 2 }}>
                {row.status === 'running' ? <LoadingOutlined /> : null} {m.label}
                {isOrchestrator && row.status === 'pending' && ` (${t('page.scheduler.statusScheduled')})`}
              </Tag>
            </div>
          );
        }
        if (row.status === 'done') {
          // 多天任务完成显示满进度条 (视觉一致)
          if (isOrchestrator) {
            return (
              <div>
                <Progress percent={100} size="small" status="success" />
                <Tag color="success" icon={<CheckCircleFilled />} style={{ fontSize: 10, marginTop: 2 }}>{t('page.scheduler.status.done')}</Tag>
              </div>
            );
          }
          return <Tag color="success" icon={<CheckCircleFilled />}>{t('page.scheduler.status.done')}</Tag>;
        }
        if (row.status === 'failed') return <Tag color="error" icon={<CloseCircleFilled />}>{t('page.scheduler.status.failed')}</Tag>;
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    {
      title: t('page.scheduler.col.scheduledAt'), dataIndex: 'scheduledAt', key: 'scheduledAt', width: 140,
      render: (ts: string) => (
        <Text style={{ fontSize: 12 }}>{dayjs(ts).format('MM-DD HH:mm')}</Text>
      ),
    },
    {
      title: t('page.scheduler.col.actions'), key: 'ops', width: 260,
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => handleRunNow(row.id)}
            title={t('page.scheduler.action.runNow')}
          >
            {t('page.scheduler.action.runNow')}
          </Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setLogTask(row)}>{t('page.scheduler.action.log')}</Button>
          {row.status === 'running' && <Button size="small" icon={<PauseCircleOutlined />} onClick={() => handlePause(row.id)} title={t('common.pause')} />}
          {row.status === 'paused' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(row.id)} title={t('common.resume')} />}
          {row.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(row.id)}>{t('page.scheduler.action.retry')}</Button>}
          {(row.status === 'running' || row.status === 'pending' || row.status === 'paused') && (
            <Popconfirm
              title={t('page.scheduler.cancelConfirm.title')}
              description={t('page.scheduler.cancelConfirm.desc')}
              onConfirm={() => handleCancel(row.id)}
            >
              <Button size="small" danger icon={<StopOutlined />} title={t('page.scheduler.action.forceStop')} />
            </Popconfirm>
          )}
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 长任务（preset_*）单独提取到顶部独立卡区
  const longRunningTasks = tasks.filter((t) =>
    (t.type as string).startsWith('preset_') && (t.status === 'running' || t.status === 'paused')
  );
  const otherTasks = tasks.filter((t) =>
    !((t.type as string).startsWith('preset_') && (t.status === 'running' || t.status === 'paused'))
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Space align="center" size={10}>
            <Title level={4} style={{ margin: 0 }}>
              <ScheduleOutlined style={{ marginRight: 8 }} />
              {t('page.scheduler.title')}
            </Title>
            <Tag color="success" style={{ fontSize: 12, margin: 0 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#52c41a', marginRight: 6, verticalAlign: 'middle' }} />
              {t('scheduler.workerRunning')}
            </Tag>
          </Space>
        </div>
        <Space>
          <Popconfirm
            title={t('scheduler.killAllConfirm')}
            okText={t('common.confirm')}
            okButtonProps={{ danger: true }}
            cancelText={t('common.cancel')}
            onConfirm={handleCancelAll}
          >
            <Button danger icon={<StopOutlined />}>{t('scheduler.killAll')}</Button>
          </Popconfirm>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            style={{ fontWeight: 500, paddingInline: 22 }}
          >
            {t('scheduler.newTask')}
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title={t('campaign.log.summary.total')} value={stats.total} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('common.running')} value={stats.running} prefix={<ThunderboltOutlined />} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('common.completed')} value={stats.done} prefix={<CheckCircleFilled style={{ color: '#52c41a' }} />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('common.failed')} value={stats.failed} prefix={<CloseCircleFilled style={{ color: '#cf1322' }} />} valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      {/* 顶部：运行中的长任务（preset_* 类） */}
      {longRunningTasks.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 16, background: '#f0f7ff', borderColor: '#91caff' }}
          title={
            <Space>
              <ThunderboltOutlined style={{ color: '#1677ff' }} />
              <Text strong>{t('scheduler.longRunningTasks')}</Text>
              <Tag color="blue">{longRunningTasks.length}</Tag>
            </Space>
          }
        >
          <Row gutter={[12, 12]}>
            {longRunningTasks.map((task) => {
              const meta = TASK_TYPE_LABELS[task.type];
              return (
                <Col key={task.id} xs={24} md={12} lg={8}>
                  <Card size="small" hoverable onClick={() => setLogTask(task)} style={{ cursor: 'pointer' }}>
                    <Space size={6} style={{ marginBottom: 8 }}>
                      <Tag color={meta?.color}>{meta?.icon} {taskTypeLabel(t, task.type)}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>{task.accountLabel}</Text>
                    </Space>
                    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>{task.name}</Text>
                    <Progress percent={task.progress} status="active" strokeColor={{ from: '#1677ff', to: '#52c41a' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(task.startedAt ?? task.scheduledAt).format('MM-DD HH:mm')}
                    </Text>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}

      <Card
        title={
          <Space>
            <Text strong>{t('scheduler.allTasks')}</Text>
            {tasks.some((task) => task.status === 'running' || task.status === 'pending') && (
              <Tag color="processing" icon={<LoadingOutlined />}>{t('scheduler.autoRefresh')} (5s)</Tag>
            )}
          </Space>
        }
      >
        <Space style={{ marginBottom: 16 }}>
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v)}
            allowClear
            placeholder={`${t('common.all')} ${t('common.status')}`}
            style={{ width: 140 }}
            options={Object.entries(STATUS_META_T).map(([k, m]) => ({ value: k, label: m.label }))}
          />
          <Select
            value={filterType}
            onChange={(v) => setFilterType(v)}
            allowClear
            placeholder={`${t('common.all')} ${t('common.type')}`}
            style={{ width: 200 }}
            showSearch
            optionFilterProp="label"
            options={buildGroupedTaskOptions()}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button>
        </Space>

        <Table
          dataSource={otherTasks}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={t('common.none')} /> }}
        />
      </Card>

      {/* 任务日志 / 详情 Modal */}
      <Modal
        title={
          <Space>
            <EyeOutlined />
            <span>{t('scheduler.taskDetail')}</span>
            {logTask?.status === 'running' && <Tag color="processing" icon={<LoadingOutlined />}>{t('scheduler.autoRefresh')} (3s)</Tag>}
          </Space>
        }
        open={!!logTask}
        onCancel={() => setLogTask(null)}
        footer={(() => {
          const showReactivate = logTask?.status === 'failed' && (
            logChildren.length > 0 ||
            logTask.type?.startsWith('preset_') ||
            logTask.type === 'keyword_lead_hunt'
          );
          const buttons: React.ReactNode[] = [];
          if (showReactivate && logTask) {
            buttons.push(
              <Tooltip
                key="reactivate"
                title="把父任务恢复为运行中，子任务会按原计划继续。适用于父任务被错误标失败的情况。"
              >
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={() => void handleReactivate(logTask.id)}
                >
                  重新激活
                </Button>
              </Tooltip>,
            );
          }
          buttons.push(<Button key="close" onClick={() => setLogTask(null)}>{t('common.close')}</Button>);
          return buttons;
        })()}
        width={640}
      >
        {logTask && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t('page.scheduler.col.id')}>#{logTask.seq ?? logTask.id.slice(0, 6)}</Descriptions.Item>
            <Descriptions.Item label={t('common.name')}>{logTask.name}</Descriptions.Item>
            <Descriptions.Item label={t('page.scheduler.col.type')}>
              <Tag color={TASK_TYPE_LABELS[logTask.type]?.color}>
                {TASK_TYPE_LABELS[logTask.type]?.icon} {taskTypeLabel(t, logTask.type)}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('page.accounts.col.label')}>{logTask.accountLabel ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('common.status')}>
              <Tag color={STATUS_META_T[logTask.status].color as any}>
                {logTask.status === 'running' ? <LoadingOutlined /> : null} {STATUS_META_T[logTask.status].label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('task.progress')}>
              <Progress percent={logTask.progress} size="small" status={logTask.status === 'failed' ? 'exception' : logTask.status === 'done' ? 'success' : 'active'} />
            </Descriptions.Item>
            <Descriptions.Item label={t('task.scheduledAt')}>{dayjs(logTask.scheduledAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            {logTask.startedAt && (
              <Descriptions.Item label={t('task.startedAt')}>{dayjs(logTask.startedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            )}
            {logTask.finishedAt && (
              <Descriptions.Item label={t('task.finishedAt')}>{dayjs(logTask.finishedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            )}
            {/* Auto-Recovery: 错误类别 + 自动重试状态 (i18n) */}
            {logTask.errorClass && resolveErrorClassMeta(logTask.errorClass, t) && (
              <Descriptions.Item label={t('task.errorClass')}>
                <Tag color={resolveErrorClassMeta(logTask.errorClass, t)!.color}>
                  {resolveErrorClassMeta(logTask.errorClass, t)!.label} ({logTask.errorClass})
                </Tag>
              </Descriptions.Item>
            )}
            {logTask.status === 'failed' && (logTask.autoRetryCount ?? 0) > 0 && (
              <Descriptions.Item label={t('task.autoRecovery')}>
                <Text style={{ fontSize: 13 }}>
                  {t('task.autoRetried', { n: logTask.autoRetryCount ?? 0, max: 2 })}
                  {logTask.lastRetryAt && (
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      ({t('task.lastRetry')}: {dayjs(logTask.lastRetryAt).format('HH:mm:ss')})
                    </Text>
                  )}
                </Text>
              </Descriptions.Item>
            )}
            {logTask.errorClass && resolveErrorClassMeta(logTask.errorClass, t) && logTask.status === 'failed' && (
              <Descriptions.Item label={t('task.systemHint')}>
                <Text style={{ fontSize: 13 }}>
                  💡 {resolveErrorClassMeta(logTask.errorClass, t)!.hint}
                </Text>
              </Descriptions.Item>
            )}
            {logTask.errorMsg && (
              <Descriptions.Item label={t('task.errorMsg')}>
                <Text type="danger" style={{ fontSize: 13 }}>{humanizeError(logTask.errorMsg)}</Text>
              </Descriptions.Item>
            )}
            {logTask.payload && Object.keys(logTask.payload).length > 0 && (
              renderPayloadAsKv(logTask.type, logTask.payload, accountSlotMap, accountOptions)
            )}
          </Descriptions>
        )}

        {/* keyword_lead_hunt → 候选人收集进度 + 来源群分布 */}
        {logTask && logTask.type === 'keyword_lead_hunt' && (
          <div style={{ marginTop: 16 }}>
            <Title level={5} style={{ marginBottom: 8 }}>
              📥 候选人收集进度 ({logHuntCount} / {(logTask.payload as any)?.targetCandidates ?? '?'})
            </Title>
            <Progress
              percent={Math.min(100, Math.round((logHuntCount / Math.max(1, (logTask.payload as any)?.targetCandidates ?? 1)) * 100))}
              status={logTask.status === 'done' ? 'success' : 'active'}
              strokeColor={{ from: '#1677ff', to: '#52c41a' }}
            />
            {logHuntSources.length > 0 && (
              <Card size="small" style={{ marginTop: 8 }} title="来源群分布">
                {logHuntSources.map((s) => (
                  <div key={s.sourceGroupId ?? 'unknown'} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f0f0f0',
                  }}>
                    <Text>{s.sourceGroupTitle ?? s.sourceGroupId ?? '(未知)'}</Text>
                    <Tag color="blue">{s.count} 人</Tag>
                  </div>
                ))}
              </Card>
            )}
            <Button
              type="link"
              style={{ marginTop: 8, padding: 0 }}
              onClick={() => { window.location.href = `/lead-candidates?huntTaskId=${logTask.id}`; }}
            >
              查看完整候选人列表 →
            </Button>
          </div>
        )}

        {/* preset 父任务 → 子任务时间线 */}
        {logTask && logChildren.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Title level={5} style={{ marginBottom: 8 }}>
              <ScheduleOutlined style={{ marginRight: 6 }} />
              {t('scheduler.childProgress')} ({logChildren.filter((c) => c.status === 'done').length}/{logChildren.length})
            </Title>
            <div style={{ maxHeight: 360, overflow: 'auto' }}>
              {logChildren.map((c) => {
                const m = STATUS_META_T[c.status];
                const tm = TASK_TYPE_LABELS[c.type];
                return (
                  <div key={c.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 10px',
                    marginBottom: 4,
                    background: c.status === 'done' ? '#f6ffed' : c.status === 'running' ? '#e6f7ff' : c.status === 'failed' ? '#fff1f0' : '#fafafa',
                    borderRadius: 4,
                    fontSize: 12,
                  }}>
                    <Tag color={tm?.color ?? 'default'} style={{ fontSize: 11, marginRight: 8 }}>
                      {tm?.icon} {taskTypeLabel(t, c.type)}
                    </Tag>
                    <Text style={{ flex: 1, fontSize: 12 }}>{c.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginRight: 10 }}>
                      {dayjs(c.scheduledAt).format('MM-DD HH:mm')}
                    </Text>
                    <Tag color={m.color as any} style={{ fontSize: 10, margin: 0 }}>
                      {c.status === 'running' ? <LoadingOutlined /> : null} {m.label}
                    </Tag>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={t('taskModal.create')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        destroyOnClose
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ scheduledAt: dayjs().add(5, 'minute') }}>
          <Form.Item name="name" label={t('taskModal.name')} rules={[{ required: true }]}>
            <Input placeholder={t('taskModal.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="type" label={t('taskModal.type')} rules={[{ required: true }]}>
            <Select
              placeholder={t('taskModal.typePlaceholder')}
              showSearch
              optionFilterProp="label"
              options={buildGroupedTaskOptions()}
            />
          </Form.Item>

          <Form.Item shouldUpdate={(p, c) => p.type !== c.type} noStyle>
            {({ getFieldValue }) => {
              const selectedType = getFieldValue('type');
              const isAB = selectedType === 'chat_script_ab';
              const is4P = selectedType === 'chat_script_4p';
              const is6P = selectedType === 'chat_script_6p';
              const isChatScript = isAB || is4P || is6P;
              const isMedia = selectedType === 'media_photo' || selectedType === 'media_video' || selectedType === 'media_voice' || selectedType === 'post_channel';
              const mediaCategory = selectedType === 'media_photo' ? 'photo'
                : selectedType === 'media_video' ? 'video'
                : selectedType === 'media_voice' ? 'voice'
                : 'photo';  // post_channel 默认 photo

              if (isMedia) {
                return <MediaTaskFields
                  taskType={selectedType}
                  category={mediaCategory}
                  accountOptions={accountOptions}
                  assetPools={assetPools}
                  assetOptions={assetOptions}
                  loadAssets={loadAssetsByCategory}
                />;
              }

              // 其他多种任务: 共用「执行账号」 + 类型特定字段
              if (!isChatScript) {
                return (
                  <>
                    <Form.Item name="accountId" label={t('taskModal.account')} rules={[{ required: true, message: t('form.required') }]}
                      extra={accountOptions.length === 0 ? '尚未添加任何账号 — 请先到「账号」页绑定一个号' : undefined}>
                      <Select
                        placeholder={accountOptions.length === 0 ? t('taskModal.accountEmpty') : t('taskModal.accountPlaceholder')}
                        showSearch
                        optionFilterProp="phone"
                        filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                        options={accountOptions}
                        disabled={accountOptions.length === 0}
                      />
                    </Form.Item>
                    <TaskTypeFields taskType={selectedType} accountOptions={accountOptions} />
                  </>
                );
              }

              // chat_script_ab / 4p / 6p — 多账号 + 剧本选择 + AI 优化
              const expectedType = isAB ? 'A+B' : is4P ? 'A+B+C+D' : 'A+B+C+D+E+F';
              const filteredScripts = scriptOptions.filter((s) => s.type === expectedType);
              const rolesLabel = isAB ? 'A ⇄ B' : is4P ? 'A + B + C + D' : 'A + B + C + D + E + F';
              return (
                <>
                  <Card size="small" style={{ marginBottom: 12, background: '#f0f7ff' }} title={
                    <Space size={6}>
                      <Text strong>💬 聊天账号设置 ({rolesLabel} 角色扮演)</Text>
                    </Space>
                  }>
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="accountAId" label="账号 A (发起方)" rules={[{ required: true }]}>
                          <Select placeholder="选择扮演 A 角色的账号" showSearch optionFilterProp="phone"
                            filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                            options={accountOptions} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="accountBId" label="账号 B (回应方)" rules={[{ required: true }]}>
                          <Select placeholder="选择扮演 B 角色的账号" showSearch optionFilterProp="phone"
                            filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                            options={accountOptions} />
                        </Form.Item>
                      </Col>
                      {(is4P || is6P) && (
                        <>
                          <Col span={12}>
                            <Form.Item name="accountCId" label="账号 C" rules={[{ required: true }]}>
                              <Select placeholder="选择扮演 C 角色的账号" showSearch optionFilterProp="phone"
                                filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={accountOptions} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="accountDId" label="账号 D" rules={[{ required: true }]}>
                              <Select placeholder="选择扮演 D 角色的账号" showSearch optionFilterProp="phone"
                                filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={accountOptions} />
                            </Form.Item>
                          </Col>
                        </>
                      )}
                      {is6P && (
                        <>
                          <Col span={12}>
                            <Form.Item name="accountEId" label="账号 E" rules={[{ required: true }]}>
                              <Select placeholder="选择扮演 E 角色的账号" showSearch optionFilterProp="phone"
                                filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={accountOptions} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="accountFId" label="账号 F" rules={[{ required: true }]}>
                              <Select placeholder="选择扮演 F 角色的账号" showSearch optionFilterProp="phone"
                                filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                                options={accountOptions} />
                            </Form.Item>
                          </Col>
                        </>
                      )}
                    </Row>
                  </Card>

                  <Form.Item shouldUpdate={(p, c) => p.chatMode !== c.chatMode} noStyle>
                    {({ getFieldValue }) => {
                      const mode = getFieldValue('chatMode') ?? 'private';
                      return (
                        <Form.Item
                          name="chatMode"
                          label="对话场景"
                          initialValue="private"
                          extra={
                            mode === 'private'
                              ? '系统会自动调 ImportContacts 把对方加为联系人，无需手动互加'
                              : undefined
                          }
                        >
                          <Radio.Group>
                            <Radio value="private">💬 私聊（A ⇄ B 直接私信）</Radio>
                            <Radio value="group">👥 群聊（在指定群里对话）</Radio>
                          </Radio.Group>
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item shouldUpdate={(p, c) => p.chatMode !== c.chatMode} noStyle>
                    {({ getFieldValue }) => getFieldValue('chatMode') === 'group' ? (
                      <Form.Item name="tgChatId" label="目标群 (tgChatId)" rules={[{ required: true, message: '请输入群 id' }]}
                        extra="格式：-100xxxxxxxxxx 或 @groupname。建议在自有群跑，不要在公开群里被发现是 bot 对话">
                        <Input placeholder="-1001234567890 或 @mytestgroup" />
                      </Form.Item>
                    ) : null}
                  </Form.Item>

                  <Card size="small" style={{ marginBottom: 12 }} title={
                    <Space>
                      <Text strong>📜 选择剧本 (共 {filteredScripts.length} 个 {isAB ? 'A+B' : is4P ? '4P' : '6P'})</Text>
                    </Space>
                  }>
                    <Form.Item name="packId" label="按剧本包随机抽" extra="留空 = 从所有同类型剧本随机抽">
                      <Select allowClear placeholder="不限剧本包"
                        options={scriptPacks
                          .filter((p) => p.types.includes(isAB ? 'A+B' : is4P ? 'A+B+C+D' : 'A+B+C+D+E+F'))
                          .map((p) => ({ value: p.packId, label: `${p.packId} (${p.count} 个)` }))}
                      />
                    </Form.Item>
                    <Form.Item name="scriptId" label="或：指定具体剧本（可选）" extra="选定后将固定跑这一个剧本，content_pool 仍会随机抽变体">
                      <Select allowClear showSearch placeholder="不指定 = 随机抽" optionFilterProp="label"
                        options={filteredScripts}
                      />
                    </Form.Item>
                  </Card>

                  <Form.Item name="aiOptimize" valuePropName="checked">
                    <Checkbox>
                      <Space size={6}>
                        <Text>✨ 启用 AI 优化对话内容</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          每条消息走 AI rewrite，不同轮次生成不同文案，更像真人 (会消耗 AI 配额)
                        </Text>
                      </Space>
                    </Checkbox>
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>

          <Form.Item label={t('taskModal.runTime')}>
            <Radio.Group value={runNow ? 'now' : 'later'} onChange={(e) => setRunNow(e.target.value === 'now')}>
              <Radio value="now"><ThunderboltOutlined /> {t('taskModal.runNow')}</Radio>
              <Radio value="later"><ClockCircleOutlined /> {t('taskModal.runLater')}</Radio>
            </Radio.Group>
          </Form.Item>
          {!runNow && (
            <Form.Item name="scheduledAt" label={t('taskModal.scheduledAt')} rules={[{ required: !runNow, message: t('form.required') }]}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

// ─── 任务详情人话化辅助函数 ────────────────────────────────────

/** 把后端常见技术错误翻译成人话 */
function humanizeError(msg: string): string {
  if (!msg) return '';
  const m = msg.toLowerCase();
  if (m.includes('cancelled by user')) return '租户主动取消';
  if (m.includes('cancelled (bulk stop)')) return '一键终止时被取消';
  if (m.includes('floodwait') || m.includes('a wait of')) {
    const sec = /(\d+)\s*seconds/.exec(msg)?.[1];
    return `Telegram 限流，需要等待 ${sec ?? '?'} 秒后才能再发`;
  }
  if (m.includes('peer_id_invalid')) return '找不到对方账号 — 可能没互加联系人或对方禁用了通过手机号查找';
  if (m.includes('user_privacy_restricted')) return '对方设了隐私限制，无法添加为联系人';
  if (m.includes('username_invalid') || m.includes('username_not_occupied')) return '用户名不存在或无效';
  if (m.includes('chat_admin_required')) return '需要群管理员权限才能执行此操作';
  if (m.includes('participants_forbidden')) return '群组禁止查看成员';
  if (m.includes('getentity') && m.includes('timed out')) return '解析对方信息超时 — 对方可能设了「不允许通过手机号查找我」隐私，或网络阻塞';
  if (m.includes('sendfile') && m.includes('timed out')) return '文件上传到 Telegram 超时（>60s），可能是网络抖动';
  if (m.includes('timed out')) return 'Telegram 接口超时，请重试';
  if (m.includes('flood')) return 'Telegram 短期限流';
  return msg;  // 兜底返回原文
}

/** 角色映射: 'A' / 'B' / 'C' / 'D' → 用户能看懂的标签 */
function lookupAccount(
  accountId: string | undefined,
  accountSlotMap: Map<string, number>,
  accountOptions: Array<{ value: string; phone: string }>,
): string {
  if (!accountId) return '—';
  const opt = accountOptions.find((o) => o.value === accountId);
  const phone = opt?.phone ?? '未知账号';
  const slot = accountSlotMap.get(accountId);
  return slot != null ? `#${String(slot).padStart(2, '0')} · ${phone}` : phone;
}

/** 把 payload 渲染成多个 Descriptions.Item — 按 task type 分支说人话 */
function renderPayloadAsKv(
  type: string,
  payload: any,
  accountSlotMap: Map<string, number>,
  accountOptions: Array<{ value: string; phone: string; label: React.ReactNode }>,
): React.ReactNode {
  const items: Array<[string, React.ReactNode]> = [];

  // chat_script_ab / 4p
  if (type === 'chat_script_ab' || type === 'chat_script_4p') {
    if (payload.accountAId) items.push(['角色 A (发起方)', lookupAccount(payload.accountAId, accountSlotMap, accountOptions)]);
    if (payload.accountBId) items.push(['角色 B (回应方)', lookupAccount(payload.accountBId, accountSlotMap, accountOptions)]);
    if (payload.accountCId) items.push(['角色 C', lookupAccount(payload.accountCId, accountSlotMap, accountOptions)]);
    if (payload.accountDId) items.push(['角色 D', lookupAccount(payload.accountDId, accountSlotMap, accountOptions)]);
    if (payload.chatMode) {
      items.push(['对话场景', payload.chatMode === 'group'
        ? <Tag color="cyan">👥 群聊</Tag>
        : <Tag color="green">💬 私聊</Tag>]);
    }
    if (payload.tgChatId) items.push(['目标群', <Text code>{payload.tgChatId}</Text>]);
    if (payload.packId) items.push(['剧本包', <Tag color="purple">{payload.packId}</Tag>]);
    if (payload.scriptId) items.push(['指定剧本 ID', <Text code>{String(payload.scriptId).slice(0, 8)}</Text>]);
    if (payload.aiOptimize) items.push(['AI 优化', <Tag color="gold">✨ 已开启</Tag>]);
  }
  // media_*/post_channel
  else if (type === 'media_photo' || type === 'media_video' || type === 'media_voice' || type === 'post_channel') {
    if (payload.targetAccountId) {
      items.push(['接收方', <span><Tag color="green">👤 内池号</Tag>{lookupAccount(payload.targetAccountId, accountSlotMap, accountOptions)}</span>]);
    } else if (payload.targetId) {
      items.push(['接收方', <span><Tag color="blue">🌐 外部</Tag><Text code>{payload.targetId}</Text></span>]);
    }
    if (payload.assetId) {
      items.push(['素材', <Tag color="orange">📌 指定具体一条 (id: {String(payload.assetId).slice(0, 8)})</Tag>]);
    } else if (payload.poolName) {
      items.push(['素材', <Tag color="orange">🎲 从 pool {payload.poolName.replace('_builtin_', '')} 随机抽</Tag>]);
    } else {
      items.push(['素材', <Tag color="orange">🎲 完全随机抽 (按类别)</Tag>]);
    }
    if (payload.caption) items.push(['文案', <Text>{payload.caption}</Text>]);
  }
  // contact_add / campaign_single 简化
  else if (type === 'contact_add' || type === 'campaign_single') {
    if (Array.isArray(payload.targets)) items.push(['触达人数', <Tag>{payload.targets.length} 人</Tag>]);
    if (payload.greetingText) items.push(['开场白', <Text italic>"{payload.greetingText}"</Text>]);
    if (Array.isArray(payload.variants)) items.push(['文案变体数', <Tag>{payload.variants.length} 条</Tag>]);
    if (Array.isArray(payload.intervalSec)) items.push(['每条间隔', `${payload.intervalSec[0]}–${payload.intervalSec[1]} 秒`]);
  }
  // group_scrape
  else if (type === 'group_scrape') {
    if (Array.isArray(payload.tgChatIds)) items.push(['爬取群数', <Tag>{payload.tgChatIds.length} 个</Tag>]);
    if (payload.maxScrapePerGroup) items.push(['每群上限', `${payload.maxScrapePerGroup} 人`]);
  }
  // join_groups / join_channels
  else if (type === 'join_groups' || type === 'join_channels') {
    const all = [...(payload.inviteLinks ?? []), ...(payload.chatIds ?? []), ...(payload.channels ?? [])];
    if (all.length) items.push(['加入目标', <Tag>{all.length} 个群/频道</Tag>]);
  }
  // browse_channel / reaction_boost / group_bubble
  else if (type === 'browse_channel') {
    if (Array.isArray(payload.channels)) items.push(['浏览频道数', <Tag>{payload.channels.length} 个</Tag>]);
    if (Array.isArray(payload.readDurationSec)) items.push(['每个停留', `${payload.readDurationSec[0]}–${payload.readDurationSec[1]} 秒`]);
  }
  else if (type === 'reaction_boost' || type === 'group_bubble') {
    if (payload.tgChatId) items.push(['目标群', <Text code>{payload.tgChatId}</Text>]);
    if (Array.isArray(payload.count)) items.push(['次数', `${payload.count[0]}–${payload.count[1]} 次`]);
  }
  // profile_update
  else if (type === 'profile_update') {
    if (payload.firstName) items.push(['新昵称 (姓)', <Text>{payload.firstName}</Text>]);
    if (payload.lastName) items.push(['新昵称 (名)', <Text>{payload.lastName}</Text>]);
    if (payload.bio) items.push(['新签名', <Text>"{payload.bio}"</Text>]);
    if (payload.photoPath) items.push(['新头像', <Text type="secondary">已设置</Text>]);
  }
  // 其他类型 — 没有专属人话渲染时，显示「无额外参数」
  else {
    if (Object.keys(payload).length > 0) {
      items.push(['参数', <Text type="secondary">（此任务类型无额外可读参数）</Text>]);
    }
  }

  return items.map(([k, v], i) => (
    <Descriptions.Item key={i} label={k}>{v}</Descriptions.Item>
  ));
}

// ─── 各任务类型的细节配置字段 ──────────────────────────────────
// 把多行文本框拆成数组 (一行一项, 忽略空行)
function linesToArr(text?: string): string[] {
  return (text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 把表单 values 映射到任务 payload (按 task type) */
function buildPayloadForTaskType(taskType: string, v: any): any {
  const t = taskType;

  // PRESET_*
  if (t === 'preset_warmup_7d' || t === 'preset_rampup_7d' || t === 'preset_full_14d' || t === 'preset_mature_ops') {
    const p: any = {};
    const ch = linesToArr(v.presetChannels); if (ch.length) p.channels = ch;
    const gr = linesToArr(v.presetGroups); if (gr.length) p.groups = gr;
    if (t === 'preset_rampup_7d' || t === 'preset_full_14d') {
      const kw = linesToArr(v.presetKeywords); if (kw.length) p.keywords = kw;
      if (v.presetIntensity) p.intensity = v.presetIntensity;
    }
    if (t === 'preset_mature_ops') {
      const og = linesToArr(v.presetOwnGroups); if (og.length) p.ownGroups = og;
    }
    return p;
  }

  if (t === 'join_groups') {
    const all = linesToArr(v.joinGroupsList);
    const inviteLinks = all.filter((x) => x.includes('joinchat') || x.includes('t.me/+'));
    const chatIds = all.filter((x) => !inviteLinks.includes(x));
    return {
      inviteLinks,
      chatIds,
      inviteIntervalSec: [v.joinIntervalMin ?? 60, v.joinIntervalMax ?? 180],
    };
  }

  if (t === 'join_groups_by_keyword') {
    return {
      keywords: linesToArr(v.searchKeywords),
      minMembers: v.searchMinMembers ?? 100,
      maxPerDay: v.searchMaxPerDay ?? 3,
    };
  }

  if (t === 'discover_groups_by_keyword') {
    return {
      keywords: linesToArr(v.searchKeywords),
      minMembers: v.searchMinMembers ?? 50,
      sampleSize: v.discoverSampleSize ?? 100,
    };
  }

  if (t === 'join_channels') {
    return { channels: linesToArr(v.channelsList) };
  }

  if (t === 'accept_invites') {
    return { autoAcceptAll: true };
  }

  if (t === 'group_create') {
    return {
      title: v.groupTitle,
      type: v.groupType ?? 'small',
      initialMemberAccountIds: v.initialMembers ?? [],
    };
  }

  if (t === 'group_invite_members') {
    return {
      tgChatId: v.inviteTgChatId,
      targetAccountIds: v.inviteTargets ?? [],
    };
  }

  if (t === 'group_bubble') {
    const p: any = {
      tgChatId: v.bubbleTgChatId,
      count: [v.bubbleCountMin ?? 1, v.bubbleCountMax ?? 2],
    };
    const pool = linesToArr(v.bubbleTextPool);
    if (pool.length) p.textPool = pool;
    return p;
  }

  if (t === 'keyword_lead_hunt') {
    return {
      keywords: linesToArr(v.huntKeywords),
      seedGroups: linesToArr(v.huntSeedGroups),
      targetCandidates: v.huntTargetCandidates ?? 300,
      durationDays: v.huntDurationDays ?? 10,
    };
  }

  if (t === 'group_scrape') {
    return {
      tgChatIds: linesToArr(v.scrapeTgChatIds),
      maxScrapePerGroup: v.scrapeMaxPerGroup ?? 50,
    };
  }

  if (t === 'contact_add') {
    const targets = linesToArr(v.contactTargetsText).map((s) => {
      // username: @x → {username:'x'}; phone: +60... → {phone:'+60...'}
      if (s.startsWith('+')) return { phone: s };
      return { username: s.replace(/^@/, '') };
    });
    const p: any = {
      mode: v.contactMode ?? 'username',
      targets,
      maxPerDay: v.contactMaxPerDay ?? 5,
    };
    if (v.contactGreeting) p.greetingText = v.contactGreeting;
    return p;
  }

  if (t === 'campaign_single') {
    const targets = linesToArr(v.campTargetsText).map((s) => {
      if (s.startsWith('+')) return { phone: s };
      return { username: s.replace(/^@/, '') };
    });
    return {
      targets,
      variants: linesToArr(v.campVariantsText),
      intervalSec: [v.campIntervalMin ?? 60, v.campIntervalMax ?? 300],
    };
  }

  if (t === 'reaction_boost') {
    const p: any = {
      tgChatId: v.reactTgChatId,
      count: [v.reactCountMin ?? 3, v.reactCountMax ?? 8],
    };
    const ep = linesToArr(v.reactEmojiPool);
    if (ep.length) p.emojiPool = ep;
    return p;
  }

  if (t === 'browse_channel') {
    return {
      channels: linesToArr(v.browseChannels),
      readDurationSec: [v.browseDurMin ?? 20, v.browseDurMax ?? 90],
    };
  }

  if (t === 'profile_update') {
    const p: any = {};
    if (v.profileFirstName) p.firstName = v.profileFirstName;
    if (v.profileLastName) p.lastName = v.profileLastName;
    if (v.profileBio) p.bio = v.profileBio;
    return p;
  }

  // idle_keepalive 等无需 payload
  return undefined;
}

interface TaskTypeFieldsProps {
  taskType: string;
  accountOptions: Array<{ value: string; label: React.ReactNode; phone: string }>;
}

function TaskTypeFields({ taskType, accountOptions }: TaskTypeFieldsProps) {
  const t = taskType;
  const tt = useT();

  // ─── PRESET_* 组合配套 ────────────────────────────────────
  if (t === 'preset_warmup_7d' || t === 'preset_rampup_7d' || t === 'preset_full_14d' || t === 'preset_mature_ops') {
    return (
      <>
        <Form.Item name="presetChannels" label={tt('taskF.preset.channels')} extra={tt('taskF.preset.channelsExtra')}>
          <Input.TextArea rows={2} placeholder="@telegram&#10;@durov" />
        </Form.Item>
        <Form.Item name="presetGroups" label={tt('taskF.preset.groups')} extra={tt('taskF.preset.groupsExtra')}>
          <Input.TextArea rows={2} placeholder="-1001234567890&#10;@some_public_chat" />
        </Form.Item>
        {(t === 'preset_rampup_7d' || t === 'preset_full_14d') && (
          <>
            <Form.Item name="presetKeywords" label={tt('taskF.preset.keywords')}>
              <Input.TextArea rows={2} placeholder="forex&#10;crypto" />
            </Form.Item>
            <Form.Item name="presetIntensity" label={tt('taskF.preset.intensity')} initialValue="mild" extra={tt('taskF.preset.intensityExtra')}>
              <Radio.Group>
                <Radio value="mild">{tt('taskF.preset.intensityMild')}</Radio>
                <Radio value="aggressive">{tt('taskF.preset.intensityAggr')}</Radio>
              </Radio.Group>
            </Form.Item>
          </>
        )}
        {t === 'preset_mature_ops' && (
          <Form.Item name="presetOwnGroups" label={tt('taskF.preset.ownGroups')}>
            <Input.TextArea rows={2} placeholder="-1001234567890" />
          </Form.Item>
        )}
      </>
    );
  }

  // ─── JOIN_GROUPS ────────────────────────────────────────
  if (t === 'join_groups') {
    return (
      <>
        <Form.Item name="joinGroupsList" label={tt('taskF.join.list')} rules={[{ required: true }]}
          extra={tt('taskF.join.listExtra')}>
          <Input.TextArea rows={4} placeholder="https://t.me/+abc123&#10;@public_group&#10;-1001234567890" />
        </Form.Item>
        <Form.Item label={tt('taskF.join.intervalLabel')} extra={tt('taskF.join.intervalExtra')}>
          <Space>
            <Form.Item name="joinIntervalMin" initialValue={60} noStyle><InputNumber min={30} max={3600} /></Form.Item>
            <span>—</span>
            <Form.Item name="joinIntervalMax" initialValue={180} noStyle><InputNumber min={30} max={3600} /></Form.Item>
          </Space>
        </Form.Item>
      </>
    );
  }

  // ─── JOIN_GROUPS_BY_KEYWORD ─────────────────────────────
  if (t === 'join_groups_by_keyword') {
    return (
      <>
        <Form.Item name="searchKeywords" label={tt('taskF.search.keywords')} rules={[{ required: true }]}
          extra={tt('taskF.search.keywordsExtraJoin')}>
          <Input.TextArea rows={3} placeholder="forex&#10;crypto" />
        </Form.Item>
        <Form.Item name="searchMinMembers" label={tt('taskF.search.minMembers')} initialValue={100} extra={tt('taskF.search.minMembersExtraJoin')}>
          <InputNumber min={10} max={100000} />
        </Form.Item>
        <Form.Item name="searchMaxPerDay" label={tt('taskF.search.maxPerDay')} initialValue={3} extra={tt('taskF.search.maxPerDayExtra')}>
          <InputNumber min={1} max={10} />
        </Form.Item>
      </>
    );
  }

  // ─── DISCOVER_GROUPS_BY_KEYWORD ─────────────────────────
  if (t === 'discover_groups_by_keyword') {
    return (
      <>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={tt('taskF.disc.alert.title')}
          description={tt('taskF.disc.alert.desc')}
        />
        <Form.Item name="searchKeywords" label={tt('taskF.search.keywords')} rules={[{ required: true }]}
          extra={tt('taskF.search.keywordsExtraDisc')}>
          <Input.TextArea rows={3} placeholder="forex trading&#10;crypto" />
        </Form.Item>
        <Form.Item name="searchMinMembers" label={tt('taskF.search.minMembers')} initialValue={50} extra={tt('taskF.search.minMembersExtraDisc')}>
          <InputNumber min={10} max={100000} />
        </Form.Item>
        <Form.Item name="discoverSampleSize" label={tt('taskF.disc.sampleSize')} initialValue={100}
          extra={tt('taskF.disc.sampleSizeExtra')}>
          <InputNumber min={20} max={200} />
        </Form.Item>
      </>
    );
  }

  // ─── JOIN_CHANNELS ──────────────────────────────────────
  if (t === 'join_channels') {
    return (
      <Form.Item name="channelsList" label={tt('taskF.channels.list')} rules={[{ required: true }]}
        extra={tt('taskF.channels.listExtra')}>
        <Input.TextArea rows={4} placeholder="@telegram&#10;@durov" />
      </Form.Item>
    );
  }

  // ─── ACCEPT_INVITES ─────────────────────────────────────
  if (t === 'accept_invites') {
    return (
      <Form.Item label={tt('taskF.note.label')}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {tt('taskF.acceptInvites.note')}
        </Text>
      </Form.Item>
    );
  }

  // ─── GROUP_CREATE ───────────────────────────────────────
  if (t === 'group_create') {
    return (
      <>
        <Form.Item name="groupTitle" label={tt('createGroup.title')} rules={[{ required: true }]}>
          <Input placeholder={tt('createGroup.titlePlaceholder')} maxLength={64} />
        </Form.Item>
        <Form.Item name="groupType" label={tt('createGroup.type')} initialValue="small">
          <Radio.Group>
            <Radio value="small">{tt('createGroup.type.small')}</Radio>
            <Radio value="mega">{tt('createGroup.type.mega')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="initialMembers" label={tt('createGroup.initialMembers')}>
          <Select mode="multiple" placeholder={tt('createGroup.initialMembersPlaceholder')} showSearch optionFilterProp="phone"
            filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
            options={accountOptions} />
        </Form.Item>
      </>
    );
  }

  // ─── GROUP_INVITE_MEMBERS ───────────────────────────────
  if (t === 'group_invite_members') {
    return (
      <>
        <Form.Item name="inviteTgChatId" label={tt('taskF.invite.tgChatId')} rules={[{ required: true }]}>
          <Input placeholder="-1001234567890 / @groupname / https://t.me/+xxx" />
        </Form.Item>
        <Form.Item name="inviteTargets" label={tt('taskF.invite.targets')} rules={[{ required: true }]}
          extra={tt('taskF.invite.targetsExtra')}>
          <Select mode="multiple" placeholder={tt('taskF.invite.targetsPlaceholder')} showSearch optionFilterProp="phone"
            filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
            options={accountOptions} />
        </Form.Item>
      </>
    );
  }

  // ─── GROUP_BUBBLE ───────────────────────────────────────
  if (t === 'group_bubble') {
    return (
      <>
        <Form.Item name="bubbleTgChatId" label={tt('taskF.bubble.tgChatId')} rules={[{ required: true }]}>
          <Input placeholder="-1001234567890 / @groupname" />
        </Form.Item>
        <Form.Item label={tt('taskF.bubble.countLabel')}>
          <Space>
            <Form.Item name="bubbleCountMin" initialValue={1} noStyle><InputNumber min={1} max={10} /></Form.Item>
            <span>—</span>
            <Form.Item name="bubbleCountMax" initialValue={2} noStyle><InputNumber min={1} max={10} /></Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="bubbleTextPool" label={tt('taskF.bubble.textPool')} extra={tt('taskF.bubble.textPoolExtra')}>
          <Input.TextArea rows={3} placeholder="👍&#10;OK&#10;got it" />
        </Form.Item>
      </>
    );
  }

  // ─── KEYWORD_LEAD_HUNT (v2 — 纯候选人收集) ───────────────
  if (t === 'keyword_lead_hunt') {
    return (
      <>
        <Form.Item name="huntKeywords" label={tt('taskF.hunt.keywords')} rules={[{ required: true }]}
          extra={tt('taskF.hunt.keywordsExtra')}>
          <Input.TextArea rows={2} placeholder="forex" />
        </Form.Item>
        <Form.Item name="huntSeedGroups" label={tt('taskF.hunt.seedGroups')}
          extra={tt('taskF.hunt.seedGroupsExtra')}>
          <Input.TextArea rows={2} placeholder="-1001234567890&#10;@my_target_chat" />
        </Form.Item>
        <Form.Item name="huntTargetCandidates" label={tt('taskF.hunt.targetCandidates')} rules={[{ required: true }]} initialValue={300}>
          <InputNumber min={10} max={5000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="huntDurationDays" label={tt('taskF.hunt.durationDays')} rules={[{ required: true }]} initialValue={10}
          extra={tt('taskF.hunt.durationDaysExtra')}>
          <InputNumber min={3} max={90} style={{ width: 160 }} />
        </Form.Item>
      </>
    );
  }

  // ─── GROUP_SCRAPE ───────────────────────────────────────
  if (t === 'group_scrape') {
    return (
      <>
        <Form.Item name="scrapeTgChatIds" label={tt('taskF.scrape.tgChatIds')} rules={[{ required: true }]}
          extra={tt('taskF.scrape.tgChatIdsExtra')}>
          <Input.TextArea rows={4} placeholder="-1001234567890&#10;@some_public_chat" />
        </Form.Item>
        <Form.Item name="scrapeMaxPerGroup" label={tt('taskF.scrape.maxPerGroup')} initialValue={50}>
          <InputNumber min={10} max={200} />
        </Form.Item>
      </>
    );
  }

  // ─── CONTACT_ADD ────────────────────────────────────────
  if (t === 'contact_add') {
    return (
      <>
        <Form.Item name="contactMode" label={tt('taskF.contact.mode')} initialValue="username">
          <Radio.Group>
            <Radio value="username">@username</Radio>
            <Radio value="phone">{tt('taskF.contact.modePhone')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="contactTargetsText" label={tt('taskF.contact.targets')} rules={[{ required: true }]}
          extra={tt('taskF.contact.targetsExtra')}>
          <Input.TextArea rows={4} placeholder="@user1&#10;@user2&#10;@user3" />
        </Form.Item>
        <Form.Item name="contactMaxPerDay" label={tt('taskF.contact.maxPerDay')} initialValue={5} extra={tt('taskF.contact.maxPerDayExtra')}>
          <InputNumber min={1} max={20} />
        </Form.Item>
        <Form.Item name="contactGreeting" label={tt('taskF.contact.greeting')}>
          <Input.TextArea rows={2} placeholder={tt('taskF.contact.greetingPlaceholder')} maxLength={500} />
        </Form.Item>
      </>
    );
  }

  // ─── CAMPAIGN_SINGLE ────────────────────────────────────
  if (t === 'campaign_single') {
    return (
      <>
        <Form.Item name="campTargetsText" label={tt('taskF.camp.targets')} rules={[{ required: true }]}>
          <Input.TextArea rows={3} placeholder="@user1&#10;@user2" />
        </Form.Item>
        <Form.Item name="campVariantsText" label={tt('taskF.camp.variants')} rules={[{ required: true }]}
          extra={tt('taskF.camp.variantsExtra')}>
          <Input.TextArea rows={4} placeholder="Hi, would love to chat...&#10;Hi, saw your profile...&#10;Are you interested..." />
        </Form.Item>
        <Form.Item label={tt('taskF.camp.intervalLabel')}>
          <Space>
            <Form.Item name="campIntervalMin" initialValue={60} noStyle><InputNumber min={30} max={3600} /></Form.Item>
            <span>—</span>
            <Form.Item name="campIntervalMax" initialValue={300} noStyle><InputNumber min={30} max={3600} /></Form.Item>
          </Space>
        </Form.Item>
      </>
    );
  }

  // ─── REACTION_BOOST ─────────────────────────────────────
  if (t === 'reaction_boost') {
    return (
      <>
        <Form.Item name="reactTgChatId" label={tt('taskF.react.tgChatId')} rules={[{ required: true }]}>
          <Input placeholder="-1001234567890 / @channel" />
        </Form.Item>
        <Form.Item label={tt('taskF.react.countLabel')}>
          <Space>
            <Form.Item name="reactCountMin" initialValue={3} noStyle><InputNumber min={1} max={50} /></Form.Item>
            <span>—</span>
            <Form.Item name="reactCountMax" initialValue={8} noStyle><InputNumber min={1} max={50} /></Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="reactEmojiPool" label={tt('taskF.react.emojiPool')} extra={tt('taskF.react.emojiPoolExtra')}>
          <Input.TextArea rows={2} placeholder="👍&#10;❤️&#10;🔥" />
        </Form.Item>
      </>
    );
  }

  // ─── BROWSE_CHANNEL ─────────────────────────────────────
  if (t === 'browse_channel') {
    return (
      <>
        <Form.Item name="browseChannels" label={tt('taskF.browse.list')} rules={[{ required: true }]}>
          <Input.TextArea rows={3} placeholder="@telegram&#10;@durov" />
        </Form.Item>
        <Form.Item label={tt('taskF.browse.dwellLabel')}>
          <Space>
            <Form.Item name="browseDurMin" initialValue={20} noStyle><InputNumber min={5} max={600} /></Form.Item>
            <span>—</span>
            <Form.Item name="browseDurMax" initialValue={90} noStyle><InputNumber min={5} max={600} /></Form.Item>
          </Space>
        </Form.Item>
      </>
    );
  }

  // ─── PROFILE_UPDATE ─────────────────────────────────────
  if (t === 'profile_update') {
    return (
      <>
        <Form.Item label={tt('taskF.note.label')}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tt('taskF.profile.note')}
          </Text>
        </Form.Item>
        <Form.Item name="profileFirstName" label={tt('taskF.profile.firstName')}>
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item name="profileLastName" label={tt('taskF.profile.lastName')}>
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item name="profileBio" label={tt('taskF.profile.bio')}>
          <Input.TextArea rows={2} maxLength={70} placeholder={tt('taskF.profile.bioPlaceholder')} />
        </Form.Item>
      </>
    );
  }

  // ─── IDLE_KEEPALIVE ─────────────────────────────────────
  if (t === 'idle_keepalive') {
    return (
      <Form.Item label={tt('taskF.note.label')}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {tt('taskF.idle.note')}
        </Text>
      </Form.Item>
    );
  }

  // 默认: 不需要额外字段
  return null;
}

// ─── 媒体任务表单 (media_*/post_channel) ────────────────────────
interface MediaTaskFieldsProps {
  taskType: string;
  category: string;
  accountOptions: Array<{ value: string; label: React.ReactNode; phone: string }>;
  assetPools: Array<{ poolName: string; category: string; count: number }>;
  assetOptions: Array<{ value: string; label: string; category: string }>;
  loadAssets: (category: string) => Promise<void>;
}

function MediaTaskFields({ taskType, category, accountOptions, assetPools, assetOptions, loadAssets }: MediaTaskFieldsProps) {
  const tt = useT();
  const poolsForCat = assetPools.filter((p) => p.category === category);
  const filteredAssetsByCat = assetOptions.filter((a) => a.category === category);

  return (
    <>
      <Form.Item name="accountId" label={tt('taskF.account.runner')} rules={[{ required: true }]}>
        <Select
          placeholder={accountOptions.length === 0 ? tt('taskF.account.empty') : tt('taskF.account.placeholder')}
          showSearch optionFilterProp="phone"
          filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
          options={accountOptions}
        />
      </Form.Item>

      {/* 接收方 */}
      <Card size="small" style={{ marginBottom: 12, background: '#f6ffed' }}
        title={<Text strong>{tt('taskF.media.recvTitle')}</Text>}>
        <Form.Item name="targetMode" initialValue="external" label={null} style={{ marginBottom: 8 }}>
          <Radio.Group>
            <Radio value="external">{tt('taskF.media.recvExternal')}</Radio>
            <Radio value="own">{tt('taskF.media.recvOwn')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item shouldUpdate={(p, c) => p.targetMode !== c.targetMode} noStyle>
          {({ getFieldValue }) => getFieldValue('targetMode') === 'own' ? (
            <Form.Item name="targetAccountId" label={null} rules={[{ required: true, message: tt('taskF.media.recvOwnRequired') }]}
              extra={tt('taskF.media.recvOwnExtra')}>
              <Select
                placeholder={tt('taskF.media.recvOwnPlaceholder')}
                showSearch optionFilterProp="phone"
                filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                options={accountOptions}
              />
            </Form.Item>
          ) : (
            <Form.Item name="targetExternal" label={null} rules={[{ required: true, message: tt('taskF.media.recvExternalRequired') }]}
              extra={tt('taskF.media.recvExternalExtra')}>
              <Input placeholder={tt('taskF.media.recvExternalPlaceholder')} />
            </Form.Item>
          )}
        </Form.Item>
      </Card>

      {/* 素材选择 */}
      <Card size="small" style={{ marginBottom: 12, background: '#fff7e6' }}
        title={<Text strong>{tt('taskF.media.assetTitle')}</Text>}>
        <Form.Item name="assetMode" initialValue="random" label={null} style={{ marginBottom: 8 }}>
          <Radio.Group onChange={() => loadAssets(category)}>
            <Radio value="random">{tt('taskF.media.assetRandom')}</Radio>
            <Radio value="specific">{tt('taskF.media.assetSpecific')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item shouldUpdate={(p, c) => p.assetMode !== c.assetMode} noStyle>
          {({ getFieldValue }) => getFieldValue('assetMode') === 'specific' ? (
            <Form.Item name="assetId" label={null} rules={[{ required: true, message: tt('taskF.media.assetSpecRequired') }]}>
              <Select
                placeholder={filteredAssetsByCat.length === 0 ? tt('taskF.media.assetSpecLoading', { category }) : tt('taskF.media.assetSpecPlaceholder')}
                showSearch optionFilterProp="label" allowClear
                options={filteredAssetsByCat}
                onFocus={() => loadAssets(category)}
              />
            </Form.Item>
          ) : (
            <Form.Item name="poolName" label={null} extra={tt('taskF.media.poolExtra', { category })}>
              <Select
                placeholder={tt('taskF.media.poolPlaceholder', { category })}
                allowClear
                options={poolsForCat.map((p) => ({
                  value: p.poolName,
                  label: `${p.poolName.replace('_builtin_', '')} ${tt('taskF.media.poolItemSuffix', { count: p.count })}`,
                }))}
              />
            </Form.Item>
          )}
        </Form.Item>
      </Card>

      {(taskType === 'media_photo' || taskType === 'media_video' || taskType === 'post_channel') && (
        <Form.Item name="caption" label={tt('taskF.media.captionLabel')} extra={tt('taskF.media.captionExtra')}>
          <Input.TextArea rows={2} placeholder={tt('taskF.media.captionPlaceholder')} maxLength={1024} />
        </Form.Item>
      )}
    </>
  );
}
