import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Button, Col, Empty, Modal, Row, Space, Statistic,
  Table, Tooltip, Typography, message as antdMessage,
} from 'antd';
import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
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
  return msg.length > 100 ? msg.slice(0, 100) + '…' : msg;
}

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
      styles={{ body: { padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' } }}
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

          {/* Tasks */}
          <Table
            dataSource={data.tasks}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
            loading={loading}
          />
        </>
      )}
    </Modal>
  );
}
