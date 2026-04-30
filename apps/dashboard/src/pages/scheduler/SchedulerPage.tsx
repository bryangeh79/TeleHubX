import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ClockCircleOutlined,
  HistoryOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;

type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'paused';

interface MockTask {
  id: string;
  name: string;
  type: string;
  status: TaskStatus;
  account: string;
  scheduledAt: string;
  finishedAt: string | null;
  progress: number;
}

const MOCK_TASKS: MockTask[] = [
  { id: '1', name: '产品 A 群发 (P3 阶段)',  type: 'campaign_broadcast', status: 'running',  account: '@cs_account_1', scheduledAt: '2026-04-30 10:00', finishedAt: null,                  progress: 42 },
  { id: '2', name: 'P2 养号 - 浏览频道',      type: 'warmup_browse',     status: 'running',  account: '@ad_account_3', scheduledAt: '2026-04-30 10:30', finishedAt: null,                  progress: 78 },
  { id: '3', name: 'ChatScript 群剧本 #12',   type: 'chat_script',       status: 'pending',  account: '@ad_account_2', scheduledAt: '2026-04-30 11:00', finishedAt: null,                  progress: 0 },
  { id: '4', name: '加入目标群组（10 个）',    type: 'join_groups',       status: 'pending',  account: '@cs_account_2', scheduledAt: '2026-04-30 11:30', finishedAt: null,                  progress: 0 },
  { id: '5', name: '产品 B 单发 (5 客户)',    type: 'campaign_single',   status: 'done',     account: '@cs_account_1', scheduledAt: '2026-04-30 09:00', finishedAt: '2026-04-30 09:14',     progress: 100 },
  { id: '6', name: 'idle keepalive',         type: 'idle_keepalive',    status: 'done',     account: '@cs_account_1', scheduledAt: '2026-04-30 08:00', finishedAt: '2026-04-30 08:01',     progress: 100 },
  { id: '7', name: '加 Reactions 到广告',     type: 'reaction_boost',    status: 'failed',   account: '@ad_account_1', scheduledAt: '2026-04-30 07:30', finishedAt: '2026-04-30 07:31',     progress: 33 },
];

const TASK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  campaign_broadcast: { label: '广告群发',       color: 'blue' },
  campaign_single:    { label: '单条消息',       color: 'cyan' },
  warmup_browse:      { label: '养号·浏览',       color: 'orange' },
  warmup_post:        { label: '养号·发帖',       color: 'orange' },
  chat_script:        { label: '群剧本',         color: 'purple' },
  join_groups:        { label: '加群',           color: 'green' },
  join_channels:      { label: '加频道',         color: 'green' },
  reaction_boost:     { label: '加 Reaction',    color: 'magenta' },
  idle_keepalive:     { label: 'keepalive',     color: 'default' },
};

const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  pending:  { label: '待运行', color: 'default' },
  running:  { label: '运行中', color: 'processing' },
  done:     { label: '已完成', color: 'success' },
  failed:   { label: '失败',   color: 'error' },
  paused:   { label: '已暂停', color: 'warning' },
};

export default function SchedulerPage() {
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const tasks = MOCK_TASKS.filter((t) => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterType !== 'all' && t.type !== filterType) return false;
    return true;
  });

  const stats = {
    total:   MOCK_TASKS.length,
    running: MOCK_TASKS.filter((t) => t.status === 'running').length,
    pending: MOCK_TASKS.filter((t) => t.status === 'pending').length,
    failed:  MOCK_TASKS.filter((t) => t.status === 'failed').length,
  };

  const columns: ColumnsType<MockTask> = [
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
    { title: '账号', dataIndex: 'account', key: 'account', width: 140 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: TaskStatus) => {
        const m = STATUS_META[s];
        return <Tag color={m.color as any}>{m.label}</Tag>;
      },
    },
    {
      title: '进度', dataIndex: 'progress', key: 'progress', width: 100,
      render: (p: number, row) => (
        <Text type={row.status === 'failed' ? 'danger' : 'secondary'}>{p}%</Text>
      ),
    },
    { title: '计划时间', dataIndex: 'scheduledAt', key: 'scheduledAt', width: 160 },
    {
      title: '操作', key: 'ops', width: 130,
      render: (_, row) => (
        <Space>
          {row.status === 'running' && <Button size="small" icon={<PauseCircleOutlined />}>暂停</Button>}
          {row.status === 'paused' && <Button size="small" type="primary" icon={<PlayCircleOutlined />}>恢复</Button>}
          {row.status === 'failed' && <Button size="small" icon={<ReloadOutlined />}>重试</Button>}
          <Button size="small" type="text">详情</Button>
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
        message="前端骨架版（mock 数据）"
        description="后端 task 表 + scheduler service 待立项。本页用于和你确认 UI/字段后再开工后端。"
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
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              ...Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label })),
            ]}
          />
          <Select
            value={filterType}
            onChange={(v) => setFilterType(v)}
            style={{ width: 160 }}
            options={[
              { value: 'all', label: '全部类型' },
              ...Object.entries(TASK_TYPE_LABELS).map(([k, m]) => ({ value: k, label: m.label })),
            ]}
          />
          <Button icon={<ReloadOutlined />}>刷新</Button>
        </Space>

        <Table
          dataSource={tasks}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="无符合条件的任务" /> }}
        />
      </Card>

      <Modal
        title="新建任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        width={640}
      >
        <Empty description="任务表单待开发（先确认 UI，再实现后端 task scheduler）" style={{ padding: 40 }} />
      </Modal>
    </div>
  );
}
