import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
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
  ClockCircleOutlined,
  DeleteOutlined,
  HistoryOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { tasksApi } from '../../services/api';

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

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      await tasksApi.create({
        name: values.name,
        type: values.type,
        accountLabel: values.accountLabel,
        scheduledAt: values.scheduledAt.toISOString(),
      });
      antdMessage.success('任务已创建');
      setCreateOpen(false);
      form.resetFields();
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
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: TaskStatus) => {
        const m = STATUS_META[s];
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    {
      title: '进度', dataIndex: 'progress', key: 'progress', width: 80,
      render: (p: number, row) => (
        <Text type={row.status === 'failed' ? 'danger' : 'secondary'}>{p}%</Text>
      ),
    },
    {
      title: '计划时间', dataIndex: 'scheduledAt', key: 'scheduledAt', width: 160,
      render: (ts: string) => dayjs(ts).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作', key: 'ops', width: 200,
      render: (_, row) => (
        <Space>
          {row.status === 'running' && <Button size="small" icon={<PauseCircleOutlined />} onClick={() => handlePause(row.id)}>暂停</Button>}
          {row.status === 'paused' && <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResume(row.id)}>恢复</Button>}
          {row.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(row.id)}>重试</Button>}
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(row.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="任务执行器（worker）尚未启动"
        description="数据库已通；新建任务会持久化但不会被自动执行。worker 进程待立项（建议复用 BullMQ + Redis）。"
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总任务" value={stats.total} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="运行中" value={stats.running} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="待运行" value={stats.pending} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="失败" value={stats.failed} valueStyle={{ color: '#cf1322' }} /></Card></Col>
      </Row>

      <Card>
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
          dataSource={tasks}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="尚无任务" /> }}
        />
      </Card>

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
          <Form.Item name="accountLabel" label="账号标签（可选）">
            <Input placeholder="如：@cs_account_1" />
          </Form.Item>
          <Form.Item name="scheduledAt" label="计划时间" rules={[{ required: true }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="任务 worker 尚未启动 — 任务会保存但不会自动执行"
            style={{ marginTop: 8 }}
          />
        </Form>
      </Modal>
    </div>
  );
}
