import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Modal, Popconfirm, Progress, Row, Select, Space,
  Statistic, Table, Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, ExperimentOutlined,
  PlayCircleOutlined, ReloadOutlined, StopOutlined, ThunderboltOutlined, TeamOutlined,
} from '@ant-design/icons';
import { discoveredGroupsApi, accountsApi } from '../../services/api';

const { Title, Text } = Typography;

type Kind = 'mega' | 'channel' | 'basic' | 'gigagroup';
type Status = 'new' | 'joined' | 'scraped' | 'ignored';

interface DiscoveredGroup {
  id: string;
  tenantId: string | null;
  tgChatId: string;
  tgUsername: string | null;
  title: string;
  kind: Kind;
  participantsCount: number;
  isGigagroup: boolean;
  hasRealSenders: boolean;
  sampledMessages: number;
  sampledRealSenders: number;
  keyword: string | null;
  status: Status;
  qualityScore: number;
  createdAt: string;
}

interface Account {
  id: string;
  phoneNumber: string;
  role: string;
  status: string;
}

const KIND_TAG: Record<Kind, { color: string; label: string }> = {
  mega: { color: 'blue', label: '超级群' },
  channel: { color: 'red', label: '频道' },
  basic: { color: 'green', label: '基础群' },
  gigagroup: { color: 'orange', label: '巨型群' },
};

const STATUS_TAG: Record<Status, { color: string; label: string }> = {
  new: { color: 'default', label: '未处理' },
  joined: { color: 'processing', label: '已加入' },
  scraped: { color: 'success', label: '已爬取' },
  ignored: { color: 'red', label: '已忽略' },
};

function qualityColor(q: number): string {
  if (q >= 70) return '#52c41a';
  if (q >= 40) return '#faad14';
  return '#ff4d4f';
}

export default function DiscoveredGroupsPage() {
  const [groups, setGroups] = useState<DiscoveredGroup[]>([]);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; avgQuality: number }>({
    total: 0, byStatus: {}, avgQuality: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | undefined>(undefined);
  const [minQuality, setMinQuality] = useState<number | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [g, s, a] = await Promise.all([
        discoveredGroupsApi.list({ status: statusFilter, minQuality, limit: 500 }),
        discoveredGroupsApi.stats(),
        accountsApi.list().catch(() => ({ data: [] as any[] })),
      ]);
      setGroups(g.data ?? []);
      setStats(s.data ?? { total: 0, byStatus: {}, avgQuality: 0 });
      setAccounts((a.data ?? []).filter((x: Account) => x.status === 'online' || x.status === 'cooling'));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter, minQuality]);

  const handleQueueScrape = async (g: DiscoveredGroup) => {
    if (!accounts.length) {
      antdMessage.error('没有 online 账号可派发任务');
      return;
    }
    Modal.confirm({
      title: `加群并爬取「${g.title}」？`,
      content: (
        <div>
          <p>将创建 2 个任务：</p>
          <ol>
            <li><b>加群</b>（立即执行）</li>
            <li><b>爬群成员</b>（10 分钟后执行，等账号同步到群 dialogs）</li>
          </ol>
          <Select
            id="account-select"
            placeholder="选择执行账号"
            style={{ width: '100%', marginTop: 12 }}
            options={accounts.map(a => ({ value: a.id, label: `${a.phoneNumber} · ${a.role}` }))}
            onChange={(v) => { (window as any).__selectedAccountId = v; }}
            defaultValue={accounts[0]?.id}
          />
        </div>
      ),
      okText: '创建任务',
      cancelText: '取消',
      onOk: async () => {
        const accountId = (window as any).__selectedAccountId ?? accounts[0]?.id;
        if (!accountId) return;
        setActionLoading(g.id);
        try {
          const res = await discoveredGroupsApi.queueScrape(g.id, accountId);
          antdMessage.success(`已创建 join+scrape 任务 (id: ${res.data?.joinTaskId?.slice(0, 8)} / ${res.data?.scrapeTaskId?.slice(0, 8)})`);
          await load();
        } catch (err: any) {
          antdMessage.error(err?.response?.data?.message ?? '创建任务失败');
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  const handleIgnore = async (g: DiscoveredGroup) => {
    setActionLoading(g.id);
    try {
      await discoveredGroupsApi.ignore(g.id);
      antdMessage.success('已忽略');
      await load();
    } catch {
      antdMessage.error('操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestore = async (g: DiscoveredGroup) => {
    setActionLoading(g.id);
    try {
      await discoveredGroupsApi.restore(g.id);
      antdMessage.success('已恢复为未处理');
      await load();
    } catch {
      antdMessage.error('操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkIgnoreSpam = async () => {
    const ids = groups.filter(g => g.status === 'new' && g.qualityScore < 30).map(g => g.id);
    if (!ids.length) { antdMessage.info('没有 quality<30 的未处理群'); return; }
    Modal.confirm({
      title: `批量忽略 ${ids.length} 个低质量群（quality<30）？`,
      content: '会把质量分低于 30 的所有未处理群标为「已忽略」。',
      onOk: async () => {
        try {
          await discoveredGroupsApi.bulkIgnore(ids);
          antdMessage.success(`已忽略 ${ids.length} 个`);
          await load();
        } catch {
          antdMessage.error('批量操作失败');
        }
      },
    });
  };

  const columns = useMemo(() => [
    {
      title: '质量',
      dataIndex: 'qualityScore',
      width: 90,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) => b.qualityScore - a.qualityScore,
      render: (q: number) => (
        <Tooltip title="基础 30 + 成员数加权 + 真发言 +30 + ≥10 真发言 +20 - gigagroup -30 - channel -50">
          <Progress
            type="circle" size={48} percent={q}
            strokeColor={qualityColor(q)}
            format={() => <span style={{ fontSize: 12, color: qualityColor(q) }}>{q}</span>}
          />
        </Tooltip>
      ),
    },
    {
      title: '群名 / 用户名',
      dataIndex: 'title',
      render: (_t: string, r: DiscoveredGroup) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.title}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {r.tgUsername ? <Text code copyable>@{r.tgUsername}</Text> : <span style={{ fontStyle: 'italic' }}>无 username</span>}
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>id: {r.tgChatId}</Text>
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 90,
      filters: [
        { text: '超级群', value: 'mega' },
        { text: '基础群', value: 'basic' },
        { text: '巨型群', value: 'gigagroup' },
        { text: '频道', value: 'channel' },
      ],
      onFilter: (v: any, r: DiscoveredGroup) => r.kind === v,
      render: (k: Kind) => <Tag color={KIND_TAG[k].color}>{KIND_TAG[k].label}</Tag>,
    },
    {
      title: '成员数',
      dataIndex: 'participantsCount',
      width: 100,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) => b.participantsCount - a.participantsCount,
      render: (n: number) => (n < 0 ? '?' : n.toLocaleString()),
    },
    {
      title: '真发言抽样',
      dataIndex: 'sampledRealSenders',
      width: 130,
      render: (n: number, r: DiscoveredGroup) => (
        r.sampledMessages > 0
          ? <span>
              {r.hasRealSenders ? <CheckCircleOutlined style={{ color: '#52c41a' }}/> : <CloseCircleOutlined style={{ color: '#ff4d4f' }}/>}
              {' '}<Text type={n > 0 ? 'success' : 'danger'}>{n}</Text>
              <Text type="secondary"> / {r.sampledMessages}</Text>
            </span>
          : <Text type="secondary">-</Text>
      ),
    },
    {
      title: '关键词',
      dataIndex: 'keyword',
      width: 100,
      render: (k: string | null) => k ? <Tag>{k}</Tag> : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      filters: Object.entries(STATUS_TAG).map(([v, t]) => ({ text: t.label, value: v })),
      onFilter: (v: any, r: DiscoveredGroup) => r.status === v,
      render: (s: Status) => <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>,
    },
    {
      title: '操作',
      width: 200,
      render: (_: any, r: DiscoveredGroup) => (
        <Space size={4}>
          {r.status === 'new' && (
            <>
              <Button size="small" type="primary" icon={<PlayCircleOutlined />}
                loading={actionLoading === r.id}
                onClick={() => handleQueueScrape(r)}>
                加+爬
              </Button>
              <Popconfirm title="忽略该群？" onConfirm={() => handleIgnore(r)}>
                <Button size="small" icon={<StopOutlined />} loading={actionLoading === r.id}>忽略</Button>
              </Popconfirm>
            </>
          )}
          {r.status === 'ignored' && (
            <Button size="small" onClick={() => handleRestore(r)} loading={actionLoading === r.id}>
              恢复
            </Button>
          )}
          {(r.status === 'joined' || r.status === 'scraped') && (
            <Tag color="default">已派发任务</Tag>
          )}
        </Space>
      ),
    },
  ], [actionLoading, accounts]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginRight: 8 }} />
          群源发现
        </Title>
        <Text type="secondary">
          关键词搜出的 TG 群池 + 质量评分。挑高质量的「加+爬」，自动避开 spam 群。
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="为什么需要这一步？"
        description="自动「搜+加+爬」流程在 forex/crypto 这类宽泛关键词上几乎全命中 spam-broadcast 群（gigagroup 不能爬成员 / 全 anonymous 发言）。改成「先搜并评估 → 你人工挑」可避免浪费宝贵的加群配额（账号上限 ~500 群）。"
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="总群数" value={stats.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="未处理" value={stats.byStatus.new ?? 0} valueStyle={{ color: '#1890ff' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已派发任务" value={(stats.byStatus.joined ?? 0) + (stats.byStatus.scraped ?? 0)} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均质量分" value={stats.avgQuality} suffix="/100" /></Card></Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="状态筛选"
            allowClear
            style={{ width: 130 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={Object.entries(STATUS_TAG).map(([v, t]) => ({ value: v, label: t.label }))}
          />
          <Select
            placeholder="最低质量分"
            allowClear
            style={{ width: 130 }}
            value={minQuality}
            onChange={setMinQuality}
            options={[
              { value: 70, label: '≥ 70 (优)' },
              { value: 50, label: '≥ 50 (中)' },
              { value: 30, label: '≥ 30 (差)' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          <Button icon={<ThunderboltOutlined />} danger onClick={handleBulkIgnoreSpam}>
            一键忽略 spam (quality&lt;30)
          </Button>
          <Text type="secondary" style={{ marginLeft: 8 }}>
            提示：到「任务调度」新建「关键词发现群 (discover_groups_by_keyword)」任务以填充此池
          </Text>
        </Space>

        {groups.length === 0 && !loading ? (
          <Empty
            description="还没有发现的群。去「任务调度」新建 discover_groups_by_keyword 任务"
            style={{ padding: 60 }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            dataSource={groups}
            size="small"
            columns={columns as any}
            pagination={{ pageSize: 50 }}
          />
        )}
      </Card>
    </div>
  );
}
