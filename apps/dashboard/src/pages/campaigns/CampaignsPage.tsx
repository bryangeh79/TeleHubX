import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Table, Button, Tag, Progress, Space, Typography, Card, Col, Row, Statistic,
  Popconfirm, Badge, Dropdown, Input, Select, Tooltip, message as antdMessage,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined,
  ReloadOutlined, TeamOutlined, FileTextOutlined, DownOutlined,
  HistoryOutlined, ClockCircleOutlined, ThunderboltOutlined,
  CheckCircleFilled, SyncOutlined, SearchOutlined,
  RedoOutlined, CopyOutlined, UserOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { campaignsApi, customerGroupsApi, tenantsApi } from '../../services/api';
import { useT } from '../../i18n';
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
  totalTargetCount: number;
  adAccountIds: string[] | null;
  accountSourceMode: string | null;
  pacePreset: string | null;
  scheduleMode: string | null;
  createdAt: string;
}

const PACE_TEXT: Record<string, { label: string; en: string }> = {
  conservative: { label: '保守', en: 'Conservative' },
  balanced:     { label: '平衡', en: 'Balanced' },
  aggressive:   { label: '投放', en: 'Aggressive' },
};

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
  const t = useT();
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [adDrawerOpen, setAdDrawerOpen] = useState(false);
  const [greetingDrawerOpen, setGreetingDrawerOpen] = useState(false);
  const [groupsDrawerOpen, setGroupsDrawerOpen] = useState(false);
  const [logCampaign, setLogCampaign] = useState<{ id: string; name: string } | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 筛选 + 搜索
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // 客户群 lookup (id → name + memberCount)
  const [groupLookup, setGroupLookup] = useState<Map<string, { name: string; memberCount: number }>>(new Map());

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

  // 加载客户群供 lookup
  useEffect(() => {
    if (!tenantId) return;
    customerGroupsApi.list(tenantId).then(r => {
      const map = new Map();
      for (const g of (r.data ?? [])) map.set(g.id, { name: g.name, memberCount: g.memberCount ?? 0 });
      setGroupLookup(map);
    }).catch(() => {});
  }, [tenantId]);

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

  // 计算总目标数：优先用 dispatch 写入的 totalTargetCount，没有就用客户群成员数 + 手动号码
  const computeTotal = (r: ApiCampaign): number => {
    if (r.totalTargetCount > 0) return r.totalTargetCount;
    let n = r.targets?.length ?? 0;
    for (const gid of r.customerGroupIds ?? []) {
      n += groupLookup.get(gid)?.memberCount ?? 0;
    }
    return n;
  };

  // 过滤后的 campaigns
  const filteredCampaigns = useMemo(() => {
    let arr = campaigns;
    if (statusFilter !== 'all') arr = arr.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      arr = arr.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        (c.customerGroupIds ?? []).some(gid => groupLookup.get(gid)?.name.toLowerCase().includes(q)),
      );
    }
    return arr;
  }, [campaigns, statusFilter, search, groupLookup]);

  const handleCopyId = (id: string) => {
    navigator.clipboard?.writeText(id).catch(() => {});
    antdMessage.success('已复制 ID');
  };

  const handleRerun = async (c: ApiCampaign) => {
    try {
      // 复制原 campaign 配置 → 新草稿。剔除所有服务端管理字段（DTO whitelist 会拒绝）
      const {
        id, status, sentCount, replyCount, totalTargetCount,
        createdAt, updatedAt, completedAt, scheduledAt,
        ...rest
      } = c as any;
      await campaignsApi.create({ ...rest, name: `${c.name} (副本)` });
      antdMessage.success(`✓ 已复制「${c.name}」为新草稿`);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
    }
  };

  const columns: ColumnsType<ApiCampaign> = [
    {
      title: '投放名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (v: string, r) => (
        <div>
          <div><Text strong style={{ fontSize: 13 }}>{v}</Text></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>ID: {r.id.slice(0, 8)}</Text>
            <CopyOutlined
              style={{ fontSize: 11, color: '#999', cursor: 'pointer' }}
              onClick={() => handleCopyId(r.id)}
            />
          </div>
          {r.description && (
            <Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text>
          )}
        </div>
      ),
    },
    {
      title: '投放类型 / 节奏档位',
      key: 'typePace',
      width: 150,
      render: (_, r) => {
        const pace = PACE_TEXT[r.pacePreset ?? 'conservative'] ?? PACE_TEXT.conservative;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={r.type === 'broadcast' ? 'blue' : 'purple'} style={{ marginRight: 0 }}>
              {TYPE_TEXT[r.type] ?? r.type}
            </Tag>
            <Text style={{ fontSize: 11 }}>
              {pace.label} <Text type="secondary" style={{ fontSize: 11 }}>({pace.en})</Text>
            </Text>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: CampaignStatus) => (
        <div>
          <Badge status={STATUS_BADGE[s]} text={<Text style={{ fontSize: 12 }}>{STATUS_TEXT[s] ?? s}</Text>} />
        </div>
      ),
    },
    {
      title: '进度 (已发 / 总目标)',
      key: 'progress',
      width: 200,
      render: (_, r) => {
        const total = computeTotal(r);
        if (total === 0) return <Tag>无目标</Tag>;
        const pct = Math.min(100, Math.round((r.sentCount / total) * 100));
        const color = pct >= 100 ? '#52c41a'
          : pct >= 50 ? '#52c41a'
          : pct >= 30 ? '#faad14'
          : r.status === 'paused' ? '#ff4d4f'
          : '#1677ff';
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
              <Text style={{ fontSize: 12 }}>{r.sentCount} / {total}</Text>
              <Text strong style={{ fontSize: 12, color }}>{pct}%</Text>
            </div>
            <Progress percent={pct} size="small" showInfo={false} strokeColor={color} />
          </div>
        );
      },
    },
    {
      title: '回复数',
      dataIndex: 'replyCount',
      key: 'replyCount',
      width: 80,
      align: 'center' as const,
      render: (v: number) => {
        const color = v === 0 ? '#bfbfbf' : v >= 10 ? '#52c41a' : '#fa8c16';
        return <Text strong style={{ fontSize: 18, color }}>{v}</Text>;
      },
    },
    {
      title: '发送号 / 客户群',
      key: 'targets',
      width: 170,
      render: (_, r) => {
        const accountCount = r.accountSourceMode === 'manual'
          ? (r.adAccountIds?.length ?? 0)
          : null; // auto 模式无固定数量
        const groupNames = (r.customerGroupIds ?? [])
          .map(gid => groupLookup.get(gid)?.name)
          .filter(Boolean);
        const manualCount = r.targets?.length ?? 0;

        return (
          <div style={{ fontSize: 12 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>📤 </Text>
              {accountCount !== null
                ? <Text>{accountCount} 个发送号</Text>
                : <Text type="secondary" style={{ fontSize: 11 }}>系统智能</Text>}
            </div>
            <div>
              <UserOutlined style={{ fontSize: 11, color: '#999', marginRight: 2 }} />
              {groupNames.length > 0
                ? <Text style={{ fontSize: 12 }}>{groupNames.join(', ')}</Text>
                : manualCount > 0
                  ? <Text type="secondary" style={{ fontSize: 11 }}>{manualCount} 个手动号码</Text>
                  : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>}
            </div>
          </div>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (v: string) => (
        <div>
          <div style={{ fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD HH:mm')}</div>
          <Text type="secondary" style={{ fontSize: 11 }}>by admin</Text>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, record) => {
        const canSend = record.status === 'draft' || record.status === 'scheduled' || record.status === 'paused';
        const hasTargets = (record.targets?.length ?? 0) > 0 || (record.customerGroupIds?.length ?? 0) > 0;
        const isRunningOrDone = record.status === 'running' || record.status === 'completed';
        return (
          <Space size={4} wrap>
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
            <Tooltip title="复制此投放配置创建新草稿（会重发给所有目标）。如只想重试失败的，请打开「日志」单独重试。">
              <Button size="small" icon={<CopyOutlined />} onClick={() => handleRerun(record)}>
                复制
              </Button>
            </Tooltip>
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
            <Title level={4} style={{ margin: 0 }}>{t('nav.campaigns')}</Title>
            {hasRunning && (
              <Tag color="processing" icon={<SyncOutlined spin />} style={{ marginLeft: 4 }}>
                {t('common.refresh')} (5s)
              </Tag>
            )}
          </div>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading} />
          <Button icon={<TeamOutlined />} onClick={() => setGroupsDrawerOpen(true)}>{t('page.campaigns.tab.groups')}</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'ad',       label: t('page.campaigns.tab.templates'), icon: <FileTextOutlined />, onClick: () => setAdDrawerOpen(true) },
                { key: 'greeting', label: t('page.campaigns.tab.greetings'), icon: <FileTextOutlined />, onClick: () => setGreetingDrawerOpen(true) },
              ],
            }}
          >
            <Button icon={<FileTextOutlined />}>
              {t('page.campaigns.tab.templates')} <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}>
            {t('page.campaigns.create')}
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

      {/* 筛选条 */}
      <Card size="small" style={{ marginBottom: 12 }} bodyStyle={{ padding: '10px 12px' }}>
        <Space wrap>
          <Select
            value={statusFilter}
            onChange={v => setStatusFilter(v)}
            style={{ width: 130 }}
            options={[
              { value: 'all',       label: '全部状态' },
              { value: 'draft',     label: '草稿' },
              { value: 'running',   label: '运行中' },
              { value: 'paused',    label: '已暂停' },
              { value: 'completed', label: '已完成' },
            ]}
          />
          <Input
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            placeholder="搜索投放名称 / 客户群 / 备注"
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={filteredCampaigns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: false, showQuickJumper: true, showTotal: (total) => `共 ${total} 条` }}
        size="middle"
        scroll={{ x: 1100 }}
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
