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
  Typography,
  message as antdMessage,
} from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DeleteOutlined,
  EyeOutlined,
  HistoryOutlined,
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
import { accountsApi, assetsApi, chatScriptsApi, slotsApi, tasksApi } from '../../services/api';

const { Title, Text } = Typography;

type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'paused';
type TaskType =
  // 组合配套
  | 'preset_full_14d' | 'preset_warmup_7d' | 'preset_rampup_7d' | 'preset_mature_ops'
  // 群组发现+加入
  | 'join_groups' | 'join_groups_by_keyword' | 'join_channels' | 'accept_invites'
  // 自建群
  | 'group_create' | 'group_invite_members'
  // 群组活动
  | 'group_bubble' | 'chat_script_ab' | 'chat_script_4p'
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

const TASK_TYPE_LABELS: Record<TaskType, TaskTypeMeta> = {
  // 组合配套（一键启动）
  preset_full_14d:        { icon: '🎯', label: '一键托管 14 天',          color: 'gold',     group: '组合配套' },
  preset_warmup_7d:       { icon: '🌱', label: '自动养号 7 天',           color: 'lime',     group: '组合配套' },
  preset_rampup_7d:       { icon: '🔥', label: '运营热身 7 天',           color: 'orange',   group: '组合配套' },
  preset_mature_ops:      { icon: '🚀', label: '成熟运营 Day 15+',        color: 'volcano',  group: '组合配套' },

  // 群组发现+加入
  join_groups:            { icon: '🌐', label: '自动加群（邀请链接）',     color: 'green',    group: '群组' },
  join_groups_by_keyword: { icon: '🔍', label: '关键词搜群+加',            color: 'green',    group: '群组' },
  join_channels:          { icon: '⭐', label: 'Follow 频道',              color: 'cyan',     group: '群组' },
  accept_invites:         { icon: '👥', label: '接受群组邀请',             color: 'green',    group: '群组' },

  // 自建群
  group_create:           { icon: '🏗️', label: '自建测试群',               color: 'purple',   group: '自建群' },
  group_invite_members:   { icon: '📨', label: '邀请账号入群',             color: 'purple',   group: '自建群' },

  // 群组活动
  group_bubble:           { icon: '💡', label: '群内冒泡',                 color: 'gold',     group: '群组活动' },
  chat_script_ab:         { icon: '💬', label: 'A+B 双角色剧本',           color: 'purple',   group: '群组活动' },
  chat_script_4p:         { icon: '💬', label: '4 人剧本',                 color: 'purple',   group: '群组活动' },

  // 拉新引流
  keyword_lead_hunt:      { icon: '🎯', label: '关键词智能引流',           color: 'magenta',  group: '拉新引流' },
  group_scrape:           { icon: '🎯', label: '群成员爬取',               color: 'magenta',  group: '拉新引流' },

  // 触达
  contact_add:            { icon: '➕', label: '加 contact',               color: 'blue',     group: '触达' },
  campaign_single:        { icon: '📝', label: '单条消息',                 color: 'cyan',     group: '触达' },

  // 内容输出
  post_channel:           { icon: '📢', label: '发频道 / Story',           color: 'blue',     group: '内容输出' },
  media_voice:            { icon: '🎤', label: '发语音 (素材池随机)',       color: 'blue',     group: '内容输出' },
  media_photo:            { icon: '🖼️', label: '发图片 (素材池随机)',       color: 'blue',     group: '内容输出' },
  media_video:            { icon: '🎬', label: '发视频 (素材池随机)',       color: 'blue',     group: '内容输出' },

  // 互动 / 保活
  reaction_boost:         { icon: '👍', label: '给消息加 Reaction',         color: 'magenta',  group: '互动 / 保活' },
  browse_channel:         { icon: '🌐', label: '浏览频道',                 color: 'default',  group: '互动 / 保活' },
  profile_update:         { icon: '📋', label: '更新资料 (签名/头像)',      color: 'default',  group: '互动 / 保活' },
  idle_keepalive:         { icon: '🔌', label: '挂机保活',                 color: 'default',  group: '互动 / 保活' },
};

/** 把 22 个任务按 group 分组成 antd Select 的 options（带 emoji）。 */
function buildGroupedTaskOptions() {
  const grouped: Record<string, Array<{ value: string; label: string }>> = {};
  for (const [k, m] of Object.entries(TASK_TYPE_LABELS)) {
    if (!grouped[m.group]) grouped[m.group] = [];
    grouped[m.group].push({ value: k, label: `${m.icon}  ${m.label}` });
  }
  // 保持 group 顺序：按首次出现顺序（Object.entries 在 Node 14+ 稳定按插入顺序）
  return Object.entries(grouped).map(([groupName, items]) => ({
    label: groupName,
    options: items,
  }));
}

const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  pending:  { label: '待运行', color: 'default' },
  running:  { label: '运行中', color: 'processing' },
  done:     { label: '已完成', color: 'success' },
  failed:   { label: '失败',   color: 'error' },
  paused:   { label: '已暂停', color: 'warning' },
};

export default function SchedulerPage() {
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
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      setStats(statsRes.data ?? { total: 0, pending: 0, running: 0, failed: 0, done: 0 });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载任务失败');
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

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      const scheduledAt = runNow ? new Date().toISOString() : values.scheduledAt.toISOString();

      // chat_script_ab / chat_script_4p：服务端会自动拆 N 个子任务
      if (values.type === 'chat_script_ab' || values.type === 'chat_script_4p') {
        const chatMode = values.chatMode ?? 'private';
        const payload: any = {
          chatMode,
          accountAId: values.accountAId,
          accountBId: values.accountBId,
          aiOptimize: values.aiOptimize ?? false,
        };
        if (chatMode === 'group') payload.tgChatId = values.tgChatId;
        if (values.type === 'chat_script_4p') {
          payload.accountCId = values.accountCId;
          payload.accountDId = values.accountDId;
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
        antdMessage.success(`已创建剧本任务（${values.type === 'chat_script_4p' ? '4 个' : '2 个'}子任务并行排队）`);
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
        const picked = accountOptions.find((o) => o.value === values.accountId);
        await tasksApi.create({
          name: values.name,
          type: values.type,
          accountId: values.accountId,
          accountLabel: picked?.phone,
          scheduledAt,
        });
        antdMessage.success(runNow ? '任务已创建并立即排队执行' : '任务已创建');
      }
      setCreateOpen(false);
      form.resetFields();
      setRunNow(true);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async (id: string) => {
    try {
      await tasksApi.pause(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '暂停失败');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await tasksApi.resume(id);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '恢复失败');
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await tasksApi.retry(id);
      antdMessage.success('已重新排入队列');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '重试失败');
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      await tasksApi.runNow(id);
      antdMessage.success('已克隆任务并立即排队执行');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '执行失败');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await tasksApi.cancel(id);
      antdMessage.success('任务已强制停止');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '停止失败');
    }
  };

  const handleCancelAll = async () => {
    try {
      const res = await tasksApi.cancelAll();
      antdMessage.success(`已强制停止 ${res.data?.cancelled ?? 0} 个任务`);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
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

  const columns: ColumnsType<Task> = [
    {
      title: '任务 ID', key: 'shortId', width: 80,
      render: (_, row) => (
        <Text code>#{row.seq ?? row.id.slice(0, 6)}</Text>
      ),
    },
    {
      title: '任务类型', key: 'type', width: 200,
      render: (_, row) => {
        const m = TASK_TYPE_LABELS[row.type];
        return (
          <Tag color={m?.color ?? 'default'} style={{ fontSize: 12, padding: '2px 8px' }}>
            {m?.icon ?? ''} {m?.label ?? row.type}
          </Tag>
        );
      },
    },
    {
      title: '目标', key: 'target', width: 280,
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
      title: '状态', key: 'status', width: 140,
      render: (_, row) => {
        const m = STATUS_META[row.status];
        if (row.status === 'running' || row.status === 'paused') {
          return (
            <div>
              <Progress percent={row.progress} size="small" status={row.status === 'paused' ? 'normal' : 'active'} />
              <Tag color={m.color as any} style={{ fontSize: 10, marginTop: 2 }}>
                {row.status === 'running' ? <LoadingOutlined /> : null} {m.label}
              </Tag>
            </div>
          );
        }
        if (row.status === 'done') return <Tag color="success" icon={<CheckCircleFilled />}>已完成</Tag>;
        if (row.status === 'failed') return <Tag color="error" icon={<CloseCircleFilled />}>失败</Tag>;
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    {
      title: '计划时间', dataIndex: 'scheduledAt', key: 'scheduledAt', width: 140,
      render: (ts: string) => (
        <Text style={{ fontSize: 12 }}>{dayjs(ts).format('MM-DD HH:mm')}</Text>
      ),
    },
    {
      title: '操作', key: 'ops', width: 260,
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => handleRunNow(row.id)}
            title="克隆该任务并立即排队执行"
          >
            执行
          </Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setLogTask(row)}>日志</Button>
          {row.status === 'running' && <Button size="small" icon={<PauseCircleOutlined />} onClick={() => handlePause(row.id)} />}
          {row.status === 'paused' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(row.id)} />}
          {row.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(row.id)}>重试</Button>}
          {(row.status === 'running' || row.status === 'pending' || row.status === 'paused') && (
            <Popconfirm
              title="强制停止此任务？"
              description="agent 完成当前 turn 后停下；任务标 failed，不会再被领取"
              onConfirm={() => handleCancel(row.id)}
            >
              <Button size="small" danger icon={<StopOutlined />} title="强制停止" />
            </Popconfirm>
          )}
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(row.id)}>
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
              任务调度
            </Title>
            <Tag
              color="success"
              style={{ fontSize: 12, margin: 0 }}
              title="agent 每 15s 拉一次任务，按 BehaviorSimulator 模拟真人执行；FloodWait 自动隔离账号"
            >
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#52c41a', marginRight: 6, verticalAlign: 'middle' }} />
              Worker 运行中
            </Tag>
          </Space>
          <div>
            <Text type="secondary">所有 Warmup / Campaign / ChatScript 任务的统一调度看板</Text>
          </div>
        </div>
        <Space>
          <Popconfirm
            title="紧急停止所有任务？"
            description={`将取消所有 pending/running/paused 任务，agent 完成当前 turn 后停下。无法恢复。`}
            okText="确认全部停止"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={handleCancelAll}
          >
            <Button danger icon={<StopOutlined />}>立即终止全部</Button>
          </Popconfirm>
          <Button icon={<HistoryOutlined />}>历史记录</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建任务</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="总任务" value={stats.total} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="运行中" value={stats.running} prefix={<ThunderboltOutlined />} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已完成" value={stats.done} prefix={<CheckCircleFilled style={{ color: '#52c41a' }} />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="失败" value={stats.failed} prefix={<CloseCircleFilled style={{ color: '#cf1322' }} />} valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      {/* 顶部：运行中的长任务（preset_* 类） */}
      {longRunningTasks.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 16, background: '#f0f7ff', borderColor: '#91caff' }}
          title={
            <Space>
              <ThunderboltOutlined style={{ color: '#1677ff' }} />
              <Text strong>运行中的长任务</Text>
              <Tag color="blue">{longRunningTasks.length} 个</Tag>
            </Space>
          }
        >
          <Row gutter={[12, 12]}>
            {longRunningTasks.map((t) => {
              const meta = TASK_TYPE_LABELS[t.type];
              return (
                <Col key={t.id} xs={24} md={12} lg={8}>
                  <Card size="small" hoverable onClick={() => setLogTask(t)} style={{ cursor: 'pointer' }}>
                    <Space size={6} style={{ marginBottom: 8 }}>
                      <Tag color={meta?.color}>{meta?.icon} {meta?.label}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>{t.accountLabel}</Text>
                    </Space>
                    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>{t.name}</Text>
                    <Progress percent={t.progress} status="active" strokeColor={{ from: '#1677ff', to: '#52c41a' }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      启动 {dayjs(t.startedAt ?? t.scheduledAt).format('MM-DD HH:mm')}
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
            <Text strong>所有任务</Text>
            {tasks.some((t) => t.status === 'running' || t.status === 'pending') && (
              <Tag color="processing" icon={<LoadingOutlined />}>自动刷新中 (5s)</Tag>
            )}
          </Space>
        }
      >
        <Space style={{ marginBottom: 16 }}>
          <Select
            value={filterStatus}
            onChange={(v) => setFilterStatus(v)}
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))}
          />
          <Select
            value={filterType}
            onChange={(v) => setFilterType(v)}
            allowClear
            placeholder="全部类型"
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
          locale={{ emptyText: <Empty description="尚无任务" /> }}
        />
      </Card>

      {/* 任务日志 / 详情 Modal */}
      <Modal
        title={
          <Space>
            <EyeOutlined />
            <span>任务详情</span>
            {logTask?.status === 'running' && <Tag color="processing" icon={<LoadingOutlined />}>实时刷新中 (3s)</Tag>}
          </Space>
        }
        open={!!logTask}
        onCancel={() => setLogTask(null)}
        footer={[<Button key="close" onClick={() => setLogTask(null)}>关闭</Button>]}
        width={640}
      >
        {logTask && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="任务编号">#{logTask.seq ?? logTask.id.slice(0, 6)}</Descriptions.Item>
            <Descriptions.Item label="任务名">{logTask.name}</Descriptions.Item>
            <Descriptions.Item label="任务类型">
              <Tag color={TASK_TYPE_LABELS[logTask.type]?.color}>
                {TASK_TYPE_LABELS[logTask.type]?.icon} {TASK_TYPE_LABELS[logTask.type]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="执行账号">{logTask.accountLabel ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_META[logTask.status].color as any}>
                {logTask.status === 'running' ? <LoadingOutlined /> : null} {STATUS_META[logTask.status].label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="进度">
              <Progress percent={logTask.progress} size="small" status={logTask.status === 'failed' ? 'exception' : logTask.status === 'done' ? 'success' : 'active'} />
            </Descriptions.Item>
            <Descriptions.Item label="计划时间">{dayjs(logTask.scheduledAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            {logTask.startedAt && (
              <Descriptions.Item label="开始时间">{dayjs(logTask.startedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            )}
            {logTask.finishedAt && (
              <Descriptions.Item label="结束时间">{dayjs(logTask.finishedAt).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
            )}
            {logTask.errorMsg && (
              <Descriptions.Item label="错误信息">
                <Text type="danger" style={{ fontSize: 13 }}>{humanizeError(logTask.errorMsg)}</Text>
              </Descriptions.Item>
            )}
            {logTask.payload && Object.keys(logTask.payload).length > 0 && (
              renderPayloadAsKv(logTask.type, logTask.payload, accountSlotMap, accountOptions)
            )}
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="新建任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={submitting}
        destroyOnClose
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ scheduledAt: dayjs().add(5, 'minute') }}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true }]}>
            <Input placeholder="如：产品 A 群发 (P3 阶段)" />
          </Form.Item>
          <Form.Item name="type" label="任务类型" rules={[{ required: true }]}>
            <Select
              placeholder="选择类型"
              showSearch
              optionFilterProp="label"
              options={buildGroupedTaskOptions()}
            />
          </Form.Item>

          <Form.Item shouldUpdate={(p, c) => p.type !== c.type} noStyle>
            {({ getFieldValue }) => {
              const t = getFieldValue('type');
              const isAB = t === 'chat_script_ab';
              const is4P = t === 'chat_script_4p';
              const isChatScript = isAB || is4P;
              const isMedia = t === 'media_photo' || t === 'media_video' || t === 'media_voice' || t === 'post_channel';
              const mediaCategory = t === 'media_photo' ? 'photo'
                : t === 'media_video' ? 'video'
                : t === 'media_voice' ? 'voice'
                : 'photo';  // post_channel 默认 photo

              if (isMedia) {
                return <MediaTaskFields
                  taskType={t}
                  category={mediaCategory}
                  accountOptions={accountOptions}
                  assetPools={assetPools}
                  assetOptions={assetOptions}
                  loadAssets={loadAssetsByCategory}
                />;
              }

              if (!isChatScript) {
                return (
                  <Form.Item name="accountId" label="执行账号" rules={[{ required: true, message: '请选择执行账号' }]}
                    extra={accountOptions.length === 0 ? '尚未添加任何账号 — 请先到「账号」页绑定一个号' : undefined}>
                    <Select
                      placeholder={accountOptions.length === 0 ? '没有可用账号' : '选择账号'}
                      showSearch
                      optionFilterProp="phone"
                      filterOption={(input, option) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                      options={accountOptions}
                      disabled={accountOptions.length === 0}
                    />
                  </Form.Item>
                );
              }

              // chat_script_ab / 4p — 多账号 + 剧本选择 + AI 优化
              const filteredScripts = scriptOptions.filter((s) => s.type === (isAB ? 'A+B' : 'A+B+C+D'));
              return (
                <>
                  <Card size="small" style={{ marginBottom: 12, background: '#f0f7ff' }} title={
                    <Space size={6}>
                      <Text strong>💬 聊天账号设置 ({isAB ? 'A ⇄ B' : 'A + B + C + D'} 角色扮演)</Text>
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
                      {is4P && (
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
                      <Text strong>📜 选择剧本 (共 {filteredScripts.length} 个 {isAB ? 'A+B' : '4P'})</Text>
                    </Space>
                  }>
                    <Form.Item name="packId" label="按剧本包随机抽" extra="留空 = 从所有同类型剧本随机抽">
                      <Select allowClear placeholder="不限剧本包"
                        options={scriptPacks
                          .filter((p) => p.types.includes(isAB ? 'A+B' : 'A+B+C+D'))
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

          <Form.Item label="执行时间">
            <Radio.Group value={runNow ? 'now' : 'later'} onChange={(e) => setRunNow(e.target.value === 'now')}>
              <Radio value="now"><ThunderboltOutlined /> 立即执行</Radio>
              <Radio value="later"><ClockCircleOutlined /> 定时执行</Radio>
            </Radio.Group>
          </Form.Item>
          {!runNow && (
            <Form.Item name="scheduledAt" label="计划时间" rules={[{ required: !runNow, message: '请选择计划时间' }]}>
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
  const poolsForCat = assetPools.filter((p) => p.category === category);
  const filteredAssetsByCat = assetOptions.filter((a) => a.category === category);

  return (
    <>
      <Form.Item name="accountId" label="执行账号 (谁来发)" rules={[{ required: true }]}>
        <Select
          placeholder={accountOptions.length === 0 ? '没有可用账号' : '选择账号'}
          showSearch optionFilterProp="phone"
          filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
          options={accountOptions}
        />
      </Form.Item>

      {/* 接收方 */}
      <Card size="small" style={{ marginBottom: 12, background: '#f6ffed' }}
        title={<Text strong>📤 接收方 (发到哪)</Text>}>
        <Form.Item name="targetMode" initialValue="external" label={null} style={{ marginBottom: 8 }}>
          <Radio.Group>
            <Radio value="external">🌐 外部目标 (群 / 频道 / 用户名)</Radio>
            <Radio value="own">👤 内池号 (本租户的账号)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item shouldUpdate={(p, c) => p.targetMode !== c.targetMode} noStyle>
          {({ getFieldValue }) => getFieldValue('targetMode') === 'own' ? (
            <Form.Item name="targetAccountId" label={null} rules={[{ required: true, message: '请选内池接收账号' }]}
              extra="任务发出去对方不会触发自动回复（自己人白名单已覆盖）">
              <Select
                placeholder="选择内池接收账号"
                showSearch optionFilterProp="phone"
                filterOption={(input, option: any) => (option?.phone ?? '').toLowerCase().includes(input.toLowerCase())}
                options={accountOptions}
              />
            </Form.Item>
          ) : (
            <Form.Item name="targetExternal" label={null} rules={[{ required: true, message: '请填外部目标' }]}
              extra="格式：-1001234567890 / @groupname / @username / +60xxx 或频道 id">
              <Input placeholder="例：@my_channel / -1001234567890" />
            </Form.Item>
          )}
        </Form.Item>
      </Card>

      {/* 素材选择 */}
      <Card size="small" style={{ marginBottom: 12, background: '#fff7e6' }}
        title={<Text strong>🎨 素材 (从素材库随机抽 或 指定具体)</Text>}>
        <Form.Item name="assetMode" initialValue="random" label={null} style={{ marginBottom: 8 }}>
          <Radio.Group onChange={() => loadAssets(category)}>
            <Radio value="random">🎲 随机抽 (按 pool / category)</Radio>
            <Radio value="specific">📌 指定具体素材</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item shouldUpdate={(p, c) => p.assetMode !== c.assetMode} noStyle>
          {({ getFieldValue }) => getFieldValue('assetMode') === 'specific' ? (
            <Form.Item name="assetId" label={null} rules={[{ required: true, message: '请选具体素材' }]}>
              <Select
                placeholder={filteredAssetsByCat.length === 0 ? `加载中或无 ${category} 素材` : '搜索 / 选择具体素材'}
                showSearch optionFilterProp="label" allowClear
                options={filteredAssetsByCat}
                onFocus={() => loadAssets(category)}
              />
            </Form.Item>
          ) : (
            <Form.Item name="poolName" label={null} extra={`留空 = 从所有 ${category} 素材随机抽`}>
              <Select
                placeholder={`不限 pool (从 ${category} 池随机抽)`}
                allowClear
                options={poolsForCat.map((p) => ({
                  value: p.poolName,
                  label: `${p.poolName.replace('_builtin_', '')} (${p.count} 件)`,
                }))}
              />
            </Form.Item>
          )}
        </Form.Item>
      </Card>

      {(taskType === 'media_photo' || taskType === 'media_video' || taskType === 'post_channel') && (
        <Form.Item name="caption" label="文案 (可选)" extra="发送时附带的文字说明">
          <Input.TextArea rows={2} placeholder="例：今日打卡，欢迎关注我们" maxLength={1024} />
        </Form.Item>
      )}
    </>
  );
}
