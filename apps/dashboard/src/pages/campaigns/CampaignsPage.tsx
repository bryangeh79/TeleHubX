import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Table, Button, Tag, Progress, Space, Typography, Card, Col, Row, Statistic,
  Popconfirm, Badge, Dropdown, message as antdMessage,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined,
  ReloadOutlined, TeamOutlined, FileTextOutlined, DownOutlined,
  HistoryOutlined, ClockCircleOutlined, ThunderboltOutlined,
  CheckCircleFilled, CloseCircleFilled, SyncOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { campaignsApi, tenantsApi } from '../../services/api';
import CampaignWizard from './CampaignWizard';
import AdTemplateDrawer from './AdTemplateDrawer';
import GreetingDrawer from './GreetingDrawer';
import CustomerGroupDrawer from './CustomerGroupDrawer';
import CampaignLogDrawer from './CampaignLogDrawer';

const { Title, Text } = Typography;

type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed';
type CampaignType = 'broadcast' | 'sequential';

interface ApiCampaign {
  id: string;
  name: string;
  description: string | null;
  type: CampaignType;
  status: CampaignStatus;
  targets: string[] | null;
  customerGroupIds: string[] | null;
  messageVariants: Array<{ text: string; mediaUrl?: string }> | null;
  sentCount: number;
  replyCount: number;
  pacePreset: string | null;
  scheduleMode: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<CampaignStatus, 'default' | 'warning' | 'processing' | 'success' | 'error'> = {
  draft:     'default',
  scheduled: 'warning',
  running:   'processing',
  paused:    'default',
  completed: 'success',
};
const STATUS_TEXT: Record<CampaignStatus, string> = {
  draft:     '草稿',
  scheduled: '已排期',
  running:   '运行中',
  paused:    '已暂停',
  completed: '已完成',
};
const TYPE_TEXT: Record<CampaignType, string> = {
  broadcast:  '群发',
  sequential: '顺序',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [adDrawerOpen, setAdDrawerOpen] = useState(false);
  const [greetingDrawerOpen, setGreetingDrawerOpen] = useState(false);
  const [groupsDrawerOpen, setGroupsDrawerOpen] = useState(false);
  const [logCampaign, setLogCampaign] = useState<{ id: string; name: string } | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 统计
  const stats = useMemo(() => {
    return {
      total: campaigns.length,
      running: campaigns.filter(c => c.status === 'running').length,
      completed: campaigns.filter(c => c.status === 'completed').length,
      draft: campaigns.filter(c => c.status === 'draft').length,
      totalSent: campaigns.reduce((s, c) => s + (c.sentCount ?? 0), 0),
      totalReplies: campaigns.reduce((s, c) => s + (c.replyCount ?? 0), 0),
    };
  }, [campaigns]);

  const hasRunning = useMemo(() => campaigns.some(c => c.status === 'running'), [campaigns]);
  const [tenantId, setTenantId] = useState<string>('');

  useEffect(() => {
    tenantsApi.getDefault().then(r => {
      if (r.data?.id) setTenantId(r.data.id);
    }).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await campaignsApi.list();
      setCampaigns(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // 自动刷新：有运行中 campaign 时每 5s 刷一次
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (hasRunning) {
      autoRefreshRef.current = setInterval(() => void reload(), 5000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [hasRunning, reload]);

  const handleDelete = async (c: ApiCampaign) => {
    try {
      await campaignsApi.delete(c.id);
      antdMessage.success(`已删除「${c.name}」`);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const handleSend = async (c: ApiCampaign) => {
    try {
      const res = await campaignsApi.send(c.id);
      const targets = res.data?.targets ?? 0;
      antdMessage.success(`已入队 — ${targets} 个目标`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? '发送失败');
    }
  };

  const openNew = () => { setEditId(undefined); setWizardOpen(true); };
  const openEdit = (id: string) => { setEditId(id); setWizardOpen(true); };
  const onWizardSuccess = () => { setWizardOpen(false); void reload(); };

  const targetCount = (r: ApiCampaign) =>
    (r.targets?.length ?? 0) + (r.customerGroupIds?.length ? 1 : 0);

  const columns: ColumnsType<ApiCampaign> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (v: string, r) => (
        <div>
          <Text strong>{v}</Text>
          {r.description && (
            <div><Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: (t: CampaignType) => (
        <Tag color={t === 'broadcast' ? 'blue' : 'purple'}>{TYPE_TEXT[t] ?? t}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: CampaignStatus) => <Badge status={STATUS_BADGE[s]} text={STATUS_TEXT[s] ?? s} />,
    },
    {
      title: '节奏',
      dataIndex: 'pacePreset',
      key: 'pacePreset',
      width: 60,
      render: (v: string | null) => {
        const map: Record<string, string> = { conservative: '保守', balanced: '平衡', aggressive: '投放' };
        return v ? <Tag>{map[v] ?? v}</Tag> : '—';
      },
    },
    {
      title: '进度',
      key: 'progress',
      render: (_, r) => {
        const manualTargets = r.targets?.length ?? 0;
        const groupCount = r.customerGroupIds?.length ?? 0;
        const hasAnyTarget = manualTargets > 0 || groupCount > 0;
        if (!hasAnyTarget) return <Tag>无目标</Tag>;
        const desc = groupCount > 0
          ? `${groupCount} 个群${manualTargets > 0 ? ` + ${manualTargets} 号` : ''}`
          : `${manualTargets} 号`;
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span>已发 {r.sentCount}</span><span>{desc}</span>
            </div>
            <Progress percent={r.sentCount > 0 ? Math.min(100, r.sentCount) : 0} size="small" showInfo={false} />
            {r.replyCount > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>{r.replyCount} 条回复</Text>
            )}
          </div>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => {
        const canSend = record.status === 'draft' || record.status === 'scheduled' || record.status === 'paused';
        const hasTargets = (record.targets?.length ?? 0) > 0 || (record.customerGroupIds?.length ?? 0) > 0;
        const isRunningOrDone = record.status === 'running' || record.status === 'completed';
        return (
          <Space size={4}>
            {canSend && hasTargets && (
              <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => handleSend(record)}>
                发送
              </Button>
            )}
            {isRunningOrDone && (
              <Button size="small" icon={<HistoryOutlined />}
                onClick={() => setLogCampaign({ id: record.id, name: record.name })}>
                日志
              </Button>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record.id)} />
            <Popconfirm
              title={`删除「${record.name}」?`}
              onConfirm={() => handleDelete(record)}
              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <SendOutlined style={{ fontSize: 22, color: '#52c41a' }} />
            <Title level={4} style={{ margin: 0 }}>广告投放</Title>
            {hasRunning && (
              <Tag color="processing" icon={<SyncOutlined spin />} style={{ marginLeft: 4 }}>
                自动刷新中 (5s)
              </Tag>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            广告投放任务、节奏与执行状态
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading} />
          <Button icon={<TeamOutlined />} onClick={() => setGroupsDrawerOpen(true)}>客户群管理</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'ad',       label: '广告文案', icon: <FileTextOutlined />, onClick: () => setAdDrawerOpen(true) },
                { key: 'greeting', label: '开场白',   icon: <FileTextOutlined />, onClick: () => setGreetingDrawerOpen(true) },
              ],
            }}
          >
            <Button icon={<FileTextOutlined />}>
              文案 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            新建投放
          </Button>
        </Space>
      </div>

      {/* Stats cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="全部投放" value={stats.total} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="运行中" value={stats.running}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已完成" value={stats.completed}
              prefix={<CheckCircleFilled style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="累计已发" value={stats.totalSent}
              suffix={stats.totalReplies > 0 ? <span style={{ fontSize: 12, color: '#8c8c8c' }}> · {stats.totalReplies} 回复</span> : undefined}
              valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={campaigns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
      />

      <CampaignWizard
        open={wizardOpen}
        editId={editId}
        onClose={() => setWizardOpen(false)}
        onSuccess={onWizardSuccess}
      />

      <AdTemplateDrawer
        open={adDrawerOpen}
        onClose={() => setAdDrawerOpen(false)}
        tenantId={tenantId}
      />

      <GreetingDrawer
        open={greetingDrawerOpen}
        onClose={() => setGreetingDrawerOpen(false)}
        tenantId={tenantId}
      />

      <CustomerGroupDrawer
        open={groupsDrawerOpen}
        onClose={() => setGroupsDrawerOpen(false)}
        tenantId={tenantId}
      />

      <CampaignLogDrawer
        open={!!logCampaign}
        campaignId={logCampaign?.id ?? null}
        campaignName={logCampaign?.name}
        onClose={() => setLogCampaign(null)}
      />
    </div>
  );
}
