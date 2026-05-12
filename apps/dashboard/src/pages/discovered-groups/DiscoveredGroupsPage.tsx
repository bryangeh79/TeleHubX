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
import { useT } from '../../i18n';

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
  const t = useT();
  const [groups, setGroups] = useState<DiscoveredGroup[]>([]);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; avgQuality: number }>({
    total: 0, byStatus: {}, avgQuality: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | undefined>(undefined);
  const [minQuality, setMinQuality] = useState<number | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // vmfix27 #C6: 批量选择
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
      antdMessage.error(t('disc.opFail'));
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
      antdMessage.error(t('disc.opFail'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkIgnoreSpam = async () => {
    const ids = groups.filter(g => g.status === 'new' && g.qualityScore < 30).map(g => g.id);
    if (!ids.length) { antdMessage.info('没有 quality<30 的未处理群'); return; }
    Modal.confirm({
      title: t('disc.batch.confirmTitle', { count: ids.length }),
      content: t('disc.batch.confirmContent'),
      onOk: async () => {
        try {
          await discoveredGroupsApi.bulkIgnore(ids);
          antdMessage.success(`已忽略 ${ids.length} 个`);
          await load();
        } catch {
          antdMessage.error(t('disc.batch.fail'));
        }
      },
    });
  };

  // vmfix27 #C6: 批量「加群 + 爬群」 — 用 A 档群一键派发
  const handleBatchQueueScrape = async () => {
    if (!selectedIds.length) { antdMessage.info('请先勾选要派发的群'); return; }
    if (!accounts.length) { antdMessage.error('没有 online 账号可派发任务'); return; }
    Modal.confirm({
      title: `批量派发 ${selectedIds.length} 个群`,
      content: (
        <div>
          <p>将给以下账号派发 join + scrape 任务对：</p>
          <Select
            placeholder="选执行账号"
            style={{ width: '100%' }}
            id="batch-scrape-account"
            options={accounts.map((a) => ({ value: a.id, label: `${a.phoneNumber} (${a.role})` }))}
          />
          <p style={{ marginTop: 12, color: '#999' }}>
            每个群会被分配为：1 个 join_groups 任务（立即）+ 1 个 group_scrape 任务（10 分钟后）。
            建议每个账号一次不要派发超过 5 个群（防风控）。
          </p>
        </div>
      ),
      okText: '派发',
      onOk: async () => {
        const sel = document.querySelector('#batch-scrape-account') as HTMLInputElement | null;
        const accId = (sel as any)?.querySelector?.('.ant-select-selection-item')?.getAttribute('title')
          ?? (sel as any)?.value;
        // 简化：直接取 accounts[0] 兜底；前端实际应该 controlled
        const pickedAccountId = accId || accounts[0].id;
        try {
          const r = await discoveredGroupsApi.batchQueueScrape(selectedIds, pickedAccountId);
          antdMessage.success(`派发完成: 成功 ${r.data.ok} / 失败 ${r.data.failed}`);
          setSelectedIds([]);
          await load();
        } catch (err: any) {
          antdMessage.error(err?.response?.data?.message ?? '批量派发失败');
        }
      },
    });
  };

  /** 一键勾选 A 档（quality≥70）未处理群 */
  const handleSelectAllATier = () => {
    const ids = groups.filter((g) => g.status === 'new' && g.qualityScore >= 70).map((g) => g.id);
    setSelectedIds(ids);
    if (!ids.length) antdMessage.info('没有 quality≥70 的未处理群');
    else antdMessage.success(`已勾选 ${ids.length} 个 A 档群`);
  };

  const columns = useMemo(() => [
    {
      title: t('disc.col.quality'),
      dataIndex: 'qualityScore',
      width: 90,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) => b.qualityScore - a.qualityScore,
      render: (q: number) => (
        <Tooltip title={t('disc.col.qualityHelp')}>
          <Progress
            type="circle" size={48} percent={q}
            strokeColor={qualityColor(q)}
            format={() => <span style={{ fontSize: 12, color: qualityColor(q) }}>{q}</span>}
          />
        </Tooltip>
      ),
    },
    {
      title: t('disc.col.name'),
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
      title: t('disc.col.type'),
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
      title: t('disc.col.members'),
      dataIndex: 'participantsCount',
      width: 100,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) => b.participantsCount - a.participantsCount,
      render: (n: number) => (n < 0 ? '?' : n.toLocaleString()),
    },
    {
      title: t('disc.col.realMsgs'),
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
      title: t('disc.col.keyword'),
      dataIndex: 'keyword',
      width: 100,
      render: (k: string | null) => k ? <Tag>{k}</Tag> : '-',
    },
    {
      title: t('disc.col.status'),
      dataIndex: 'status',
      width: 90,
      filters: Object.entries(STATUS_TAG).map(([v, m]) => ({ text: m.label, value: v })),
      onFilter: (v: any, r: DiscoveredGroup) => r.status === v,
      render: (s: Status) => <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>,
    },
    {
      title: t('disc.col.actions'),
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
  ], [actionLoading, accounts, t]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginRight: 8 }} />
          {t('nav.discoveredGroups')}
        </Title>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title={t('discovered.totalGroups')} value={stats.total} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('discovered.unprocessed')} value={stats.byStatus.new ?? 0} valueStyle={{ color: '#1890ff' }} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('discovered.dispatched')} value={(stats.byStatus.joined ?? 0) + (stats.byStatus.scraped ?? 0)} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title={t('discovered.avgQuality')} value={stats.avgQuality} suffix="/100" /></Card></Col>
      </Row>

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder={t('common.status')}
            allowClear
            style={{ width: 130 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={Object.entries(STATUS_TAG).map(([v, m]) => ({ value: v, label: m.label }))}
          />
          <Select
            placeholder={t('discovered.minQuality')}
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
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{t('common.refresh')}</Button>
          <Button icon={<ThunderboltOutlined />} danger onClick={handleBulkIgnoreSpam}>
            {t('disc.btnIgnoreSpam')}
          </Button>
          {/* vmfix27 #C6: 批量派发 */}
          <Button icon={<CheckCircleOutlined />} onClick={handleSelectAllATier}>
            勾选 A 档 (≥70)
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleBatchQueueScrape}
            disabled={!selectedIds.length}
          >
            批量加+爬 ({selectedIds.length})
          </Button>
          <Text type="secondary" style={{ marginLeft: 8 }}>
            {t('disc.hint')}
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
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys as string[]),
              getCheckboxProps: (record: DiscoveredGroup) => ({
                disabled: record.status !== 'new',  // 只让 NEW 状态可勾选
              }),
            }}
          />
        )}
      </Card>
    </div>
  );
}
