import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Col, Empty, Modal, Progress, Row, Space, Statistic,
  Table, Tabs, Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import { HistoryOutlined, ReloadOutlined, ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { campaignsApi } from '../../services/api';

const { Text } = Typography;

interface Props {
  open: boolean;
  campaignId: string | null;
  campaignName?: string;
  onClose: () => void;
}

interface TaskRow {
  id: string;
  seq: number | null;
  status: string;
  accountLabel: string | null;
  target: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMsg: string | null;
}

interface SummaryShape {
  total: number; pending: number; running: number;
  done: number; failed: number; paused: number;
}

const STATUS_TEXT: Record<string, { label: string; color: string }> = {
  pending:   { label: '待发',   color: 'default' },
  running:   { label: '发送中', color: 'processing' },
  done:      { label: '已发',   color: 'success' },
  succeeded: { label: '已发',   color: 'success' },
  failed:    { label: '失败',   color: 'error' },
  canceled:  { label: '已取消', color: 'default' },
};

/** 把技术错误码翻译成人话 */
function humanizeError(msg: string | null): string {
  if (!msg) return '';
  const m = msg.toLowerCase();
  if (m.includes('user_privacy_restricted')) return '对方设置了隐私限制，无法私聊';
  if (m.includes('peer_id_invalid')) return '号码无效或已注销';
  if (m.includes('username_not_occupied')) return '用户名不存在';
  if (m.includes('flood_wait')) {
    const sec = msg.match(/(\d+)/)?.[1];
    return `频率限制${sec ? `，需等 ${sec} 秒` : ''}`;
  }
  if (m.includes('peer_flood')) return '账号触发风控，今天暂停';
  if (m.includes('user_blocked_by_admin')) return '该号被对方屏蔽';
  if (m.includes('could not find the input entity')) return '解析联系人失败 (可能需先 import contact)';
  if (msg.includes('解析目标') && msg.includes('超时')) return 'TG 解析联系人超时，账号网络/代理可能不稳';
  if (msg.includes('发送消息') && msg.includes('超时')) return 'TG 发送消息超时，可点「再次执行」重试';
  if (msg.includes('任务执行超时')) return '任务超时（>10 分钟未完成）';
  return msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
}

/** 时段窗口定义（与后端 conservative/balanced 一致） */
const WINDOWS = [
  { startH: 9,  startM: 30, endH: 11, endM: 30, label: '09:30 – 11:30' },
  { startH: 14, startM: 0,  endH: 16, endM: 30, label: '14:00 – 16:30' },
  { startH: 18, startM: 0,  endH: 20, endM: 30, label: '18:00 – 20:30' },
];

/** 根据小时+分钟判断属于哪个时段标签；落在窗口外（fast-path）→ 立即发送 */
function windowLabel(hour: number, minute: number): string {
  for (const w of WINDOWS) {
    const inStart = hour > w.startH || (hour === w.startH && minute >= w.startM);
    const inEnd = hour < w.endH || (hour === w.endH && minute <= w.endM);
    if (inStart && inEnd) return w.label;
  }
  return '立即发送（窗口外）';
}

// ── 调度分布 Tab ──────────────────────────────────────────────────────────
function DistributionTab({ tasks }: { tasks: TaskRow[] }) {
  const schedule = useMemo(() => {
    if (!tasks.length) return [];

    // 按日期分组
    const byDay = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      const date = dayjs(t.scheduledAt).format('YYYY-MM-DD');
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date)!.push(t);
    }

    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, dayTasks], di) => {
        // 每天内按时段分组
        const byWindow = new Map<string, TaskRow[]>();
        for (const t of dayTasks) {
          const d = dayjs(t.scheduledAt);
          const label = windowLabel(d.hour(), d.minute());
          if (!byWindow.has(label)) byWindow.set(label, []);
          byWindow.get(label)!.push(t);
        }

        const windows = Array.from(byWindow.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([label, wTasks]) => {
            const sorted = [...wTasks].sort((a, b) =>
              new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
            );
            const done = wTasks.filter(t => t.status === 'done' || t.status === 'succeeded').length;
            const failed = wTasks.filter(t => t.status === 'failed').length;
            const pending = wTasks.filter(t => t.status === 'pending').length;
            return {
              label,
              count: wTasks.length,
              done, failed, pending,
              firstAt: sorted[0].scheduledAt,
              lastAt: sorted[sorted.length - 1].scheduledAt,
            };
          });

        const dayDone = dayTasks.filter(t => t.status === 'done' || t.status === 'succeeded').length;
        const dayFailed = dayTasks.filter(t => t.status === 'failed').length;

        return { date, di, total: dayTasks.length, done: dayDone, failed: dayFailed, windows };
      });
  }, [tasks]);

  if (!schedule.length) {
    return <Empty description="暂无调度数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 32 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {schedule.map(day => (
        <div
          key={day.date}
          style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: '12px 16px', background: '#fafafa' }}
        >
          {/* 日期标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Tag color="blue" style={{ fontWeight: 600 }}>第 {day.di + 1} 天</Tag>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{dayjs(day.date).format('M月D日 (ddd)')}</span>
            <span style={{ color: '#999', fontSize: 12 }}>共 {day.total} 条</span>
            {day.done > 0 && <Tag color="success" style={{ fontSize: 11 }}>已发 {day.done}</Tag>}
            {day.failed > 0 && <Tag color="error" style={{ fontSize: 11 }}>失败 {day.failed}</Tag>}
            {day.total - day.done - day.failed > 0 &&
              <Tag color="default" style={{ fontSize: 11 }}>待发 {day.total - day.done - day.failed}</Tag>
            }
          </div>

          {/* 时段列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {day.windows.map(win => (
              <div
                key={win.label}
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}
              >
                <span style={{
                  color: win.label.startsWith('立即') ? '#fa8c16' : '#1677ff',
                  minWidth: 160,
                  fontFamily: 'monospace',
                }}>{win.label}</span>
                <Progress
                  percent={win.count ? Math.round(win.done / win.count * 100) : 0}
                  size="small"
                  style={{ width: 120, margin: 0 }}
                  strokeColor="#52c41a"
                  format={() => `${win.done}/${win.count}`}
                />
                {win.failed > 0 && <Tag color="error" style={{ fontSize: 10 }}>失败 {win.failed}</Tag>}
                <span style={{ color: '#aaa' }}>
                  {dayjs(win.firstAt).format('HH:mm')} – {dayjs(win.lastAt).format('HH:mm')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────
export default function CampaignLogDrawer({ open, campaignId, campaignName, onClose }: Props) {
  const [data, setData] = useState<{
    summary: SummaryShape;
    tasks: TaskRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const res = await campaignsApi.listTasks(campaignId);
      setData(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { if (open && campaignId) void load(); }, [open, campaignId, load]);

  const columns = [
    {
      title: '#',
      dataIndex: 'seq',
      width: 60,
      render: (v: number | null) => v ? `#${v}` : '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => {
        const cfg = STATUS_TEXT[s] ?? { label: s, color: 'default' };
        return <Badge status={cfg.color as any} text={cfg.label} />;
      },
    },
    {
      title: '账号',
      dataIndex: 'accountLabel',
      width: 130,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '目标',
      dataIndex: 'target',
      ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '计划时间',
      dataIndex: 'scheduledAt',
      width: 130,
      render: (v: string) => dayjs(v).format('M/D HH:mm:ss'),
    },
    {
      title: '完成时间',
      dataIndex: 'finishedAt',
      width: 130,
      render: (v: string | null) => v ? dayjs(v).format('M/D HH:mm:ss') : '—',
    },
    {
      title: '错误信息',
      dataIndex: 'errorMsg',
      ellipsis: true,
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">—</Text>;
        const friendly = humanizeError(v);
        return (
          <Tooltip title={v}>
            <Text type="danger" style={{ fontSize: 12 }}>{friendly}</Text>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <HistoryOutlined style={{ color: '#1677ff' }} />
          <span>执行日志 · {campaignName ?? '...'}</span>
        </Space>
      }
      width={1100}
      centered
      footer={
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={onClose}>关闭</Button>
        </Space>
      }
      styles={{ body: { padding: '16px 20px', maxHeight: '75vh', overflowY: 'auto' } }}
    >
      {!data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          {loading ? '加载中…' : '无数据'}
        </div>
      ) : data.summary.total === 0 ? (
        <Empty
          description="还没有派发出来的任务"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: 40 }}
        />
      ) : (
        <>
          {/* Stats */}
          <Row gutter={8} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <Statistic title="总数" value={data.summary.total} valueStyle={{ fontSize: 18 }} />
            </Col>
            <Col span={4}>
              <Statistic title="待发" value={data.summary.pending} valueStyle={{ fontSize: 18, color: '#8c8c8c' }} />
            </Col>
            <Col span={4}>
              <Statistic title="发送中" value={data.summary.running} valueStyle={{ fontSize: 18, color: '#1677ff' }} />
            </Col>
            <Col span={4}>
              <Statistic title="已发" value={data.summary.done} valueStyle={{ fontSize: 18, color: '#52c41a' }} />
            </Col>
            <Col span={4}>
              <Statistic title="失败" value={data.summary.failed} valueStyle={{ fontSize: 18, color: '#ff4d4f' }} />
            </Col>
            <Col span={4}>
              <Statistic title="已暂停" value={data.summary.paused} valueStyle={{ fontSize: 18, color: '#8c8c8c' }} />
            </Col>
          </Row>

          {/* Tabs: 任务明细 + 调度分布 */}
          <Tabs
            size="small"
            items={[
              {
                key: 'tasks',
                label: '任务明细',
                children: (
                  <Table
                    dataSource={data.tasks}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
                    loading={loading}
                  />
                ),
              },
              {
                key: 'distribution',
                label: (
                  <Space size={4}>
                    <ScheduleOutlined />
                    调度分布
                  </Space>
                ),
                children: <DistributionTab tasks={data.tasks} />,
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
