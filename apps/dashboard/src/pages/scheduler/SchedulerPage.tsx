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
  | 'campaign_broadcast' | 'campaign_single'
  | 'warmup_browse'      | 'warmup_post'
  | 'chat_script'
  | 'join_groups'        | 'join_channels'
  | 'reaction_boost'
  | 'idle_keepalive';

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

const TASK_TYPE_LABELS: Record<TaskType, { label: string; color: string }> = {
  campaign_broadcast: { label: '广告群发',     color: 'blue' },
  campaign_single:    { label: '单条消息',     color: 'cyan' },
  warmup_browse:      { label: '养号·浏览',     color: 'orange' },
  warmup_post:        { label: '养号·发帖',     color: 'orange' },
  chat_script:        { label: '群剧本',       color: 'purple' },
  join_groups:        { label: '加群',         color: 'green' },
  join_channels:      { label: '加频道',       color: 'green' },
  reaction_boost:     { label: '加 Reaction',  color: 'magenta' },
  idle_keepalive:     { label: 'keepalive',   color: 'default' },
};

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
            {TASK_TYPE_LABELS[row.type]?.label ?? row.type}
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
            style={{ width: 160 }}
            options={Object.entries(TASK_TYPE_LABELS).map(([k, m]) => ({ value: k, label: m.label }))}
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
              options={Object.entries(TASK_TYPE_LABELS).map(([k, m]) => ({ value: k, label: m.label }))}
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
