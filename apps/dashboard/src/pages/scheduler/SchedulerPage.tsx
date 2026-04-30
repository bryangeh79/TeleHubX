import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
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
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { accountsApi, tasksApi } from '../../services/api';

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
  tenantId: string | null;
  name: string;
  type: TaskType;
  status: TaskStatus;
  accountId: string | null;
  accountLabel: string | null;
  payload: Record<string, unknown> | null;
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

  // 「立即执行」开关
  const [runNow, setRunNow] = useState(true);

  // 任务详情/日志查看
  const [logTask, setLogTask] = useState<Task | null>(null);

  // 自动刷新计时器
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await accountsApi.list();
      const accounts: any[] = Array.isArray(res.data) ? res.data : [];
      const opts = accounts.map((a) => ({
        value: a.id,
        phone: a.phoneNumber,
        label: (
          <Space size={6}>
            <Text strong>{a.phoneNumber}</Text>
            <Tag color={a.role === 'cs' ? 'blue' : a.role === 'ad' ? 'green' : 'orange'} style={{ fontSize: 10 }}>
              {a.role.toUpperCase()}
            </Tag>
            <Tag color={a.status === 'online' ? 'green' : 'default'} style={{ fontSize: 10 }}>
              {a.status === 'online' ? '在线' : a.status}
            </Tag>
          </Space>
        ),
      }));
      setAccountOptions(opts);
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
      const picked = accountOptions.find((o) => o.value === values.accountId);
      const scheduledAt = runNow ? new Date().toISOString() : values.scheduledAt.toISOString();
      await tasksApi.create({
        name: values.name,
        type: values.type,
        accountId: values.accountId,
        accountLabel: picked?.phone,
        scheduledAt,
      });
      antdMessage.success(runNow ? '任务已创建并立即排队执行' : '任务已创建');
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
      title: '任务名称', dataIndex: 'name', key: 'name',
      render: (name: string, row) => (
        <div>
          <Text strong>{name}</Text>
          <br />
          <Tag color={TASK_TYPE_LABELS[row.type]?.color ?? 'default'} style={{ fontSize: 11, marginTop: 2 }}>
            {TASK_TYPE_LABELS[row.type]?.icon ?? ''} {TASK_TYPE_LABELS[row.type]?.label ?? row.type}
          </Tag>
        </div>
      ),
    },
    {
      title: '账号', dataIndex: 'accountLabel', key: 'accountLabel', width: 160,
      render: (label: string | null) => label || <Text type="secondary">—</Text>,
    },
    {
      title: '进度 / 状态', key: 'progress', width: 130,
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
        if (row.status === 'done') {
          return (
            <Tag color="success" icon={<CheckCircleFilled />} style={{ fontSize: 12 }}>已完成</Tag>
          );
        }
        if (row.status === 'failed') {
          return (
            <Tag color="error" icon={<CloseCircleFilled />} style={{ fontSize: 12 }}>失败</Tag>
          );
        }
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
      title: '操作', key: 'ops', width: 220,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setLogTask(row)}>日志</Button>
          {row.status === 'running' && <Button size="small" icon={<PauseCircleOutlined />} onClick={() => handlePause(row.id)} />}
          {row.status === 'paused' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(row.id)} />}
          {row.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(row.id)}>重试</Button>}
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
          <Title level={4} style={{ margin: 0 }}>
            <ScheduleOutlined style={{ marginRight: 8 }} />
            任务调度
          </Title>
          <Text type="secondary">所有 Warmup / Campaign / ChatScript 任务的统一调度看板</Text>
        </div>
        <Space>
          <Button icon={<HistoryOutlined />}>历史记录</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建任务</Button>
        </Space>
      </div>

      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message="任务 Worker 运行中"
        description="agent 每 15s 自动领取到期任务，按 BehaviorSimulator（Gaussian 间隔 / typing 指示器）模拟真人执行。FloodWait 自动隔离账号。已支持执行器：挂机保活、Follow 频道、浏览频道、加 Reaction、群内冒泡。"
      />

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
            <Descriptions.Item label="任务名">{logTask.name}</Descriptions.Item>
            <Descriptions.Item label="类型">
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
              <Descriptions.Item label="错误">
                <Text type="danger" style={{ fontSize: 12, fontFamily: 'monospace' }}>{logTask.errorMsg}</Text>
              </Descriptions.Item>
            )}
            {logTask.payload && Object.keys(logTask.payload).length > 0 && (
              <Descriptions.Item label="payload">
                <pre style={{ margin: 0, fontSize: 11, background: '#fafafa', padding: 8, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>
                  {JSON.stringify(logTask.payload, null, 2)}
                </pre>
              </Descriptions.Item>
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
        width={560}
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
          <Alert
            type="success"
            showIcon
            message="任务 worker 已上线 — agent 每 15 秒拉一次任务自动执行"
            description="计划时间到达后, agent 会按 BehaviorSimulator (Gaussian 间隔 / typing 指示器) 模拟真人执行"
            style={{ marginTop: 8 }}
          />
        </Form>
      </Modal>
    </div>
  );
}
