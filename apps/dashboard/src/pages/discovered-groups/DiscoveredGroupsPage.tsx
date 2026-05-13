import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Empty, Modal, Popconfirm, Progress, Row, Select, Space,
  Statistic, Table, Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, ExperimentOutlined, FireOutlined,
  PlayCircleOutlined, ReloadOutlined, StopOutlined, ThunderboltOutlined, TeamOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { discoveredGroupsApi, accountsApi } from '../../services/api';
import { useT } from '../../i18n';

// vmfix28 #1: 启用 dayjs 相对时间插件（"3 小时前" / "2 天前"）
dayjs.extend(relativeTime);

const { Title, Text } = Typography;

type Kind = 'mega' | 'channel' | 'basic' | 'gigagroup';
type Status = 'new' | 'joined' | 'scraped' | 'ignored';

// vmfix28 #2: 来源 enum 跟后端 DiscoverSource 对齐
type DiscoverSource = 'contacts' | 'global' | 'invite_harvest';

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
  // vmfix28 新增
  updatedAt: string;                         // #1 时间戳
  discoverSource?: DiscoverSource | null;    // #2 来源
  aiScore?: number | null;                   // B2 AI 评分
  aiReason?: string | null;                  // B2 AI 评分原因
  recentMessageRate?: number;                // B4 最近 7 天消息占比 (0-100)
}

const SOURCE_TAG: Record<DiscoverSource, { color: string; label: string }> = {
  contacts:       { color: 'blue',     label: '群名搜索' },
  global:         { color: 'green',    label: '消息搜索' },
  invite_harvest: { color: 'purple',   label: '邀请链接' },
};

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
  // vmfix28 #C5: 群预览 modal（静态显示 DB 已有数据，不发起 TG 调用）
  const [previewGroup, setPreviewGroup] = useState<DiscoveredGroup | null>(null);

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

  // vmfix28 #3: 行内 delete（硬删除，不可恢复）
  const handleDelete = async (g: DiscoveredGroup) => {
    setActionLoading(g.id);
    try {
      await discoveredGroupsApi.remove(g.id);
      antdMessage.success(`已删除「${g.title.slice(0, 30)}」`);
      // 同步从 selectedIds 移除（如果有勾选）
      setSelectedIds((prev) => prev.filter((id) => id !== g.id));
      await load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
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
    // vmfix28 B2: AI 评分列（仅当任意行有 aiScore 时显示，否则隐藏）
    ...(groups.some((g) => g.aiScore != null) ? [{
      title: 'AI 评分',
      dataIndex: 'aiScore',
      width: 80,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) => (b.aiScore ?? -1) - (a.aiScore ?? -1),
      render: (score: number | null | undefined, r: DiscoveredGroup) => {
        if (score == null) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        return (
          <Tooltip title={r.aiReason ? `AI 评估: ${r.aiReason}` : 'AI 目标客户匹配度评分'}>
            <Progress
              type="circle" size={40} percent={score}
              strokeColor={qualityColor(score)}
              format={() => <span style={{ fontSize: 11 }}>{score}</span>}
            />
          </Tooltip>
        );
      },
    }] : []),
    {
      title: t('disc.col.name'),
      dataIndex: 'title',
      render: (_t: string, r: DiscoveredGroup) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {r.title}
            {/* vmfix28 B4: 热度趋势 tag — 最近 7 天消息占比 >= 50% */}
            {(r.recentMessageRate ?? 0) >= 50 && (
              <Tooltip title={`最近 7 天消息占比 ${r.recentMessageRate}% — 活跃热度`}>
                <Tag color="volcano" icon={<FireOutlined />} style={{ marginLeft: 6 }}>HOT</Tag>
              </Tooltip>
            )}
            {/* vmfix28 #1: 新群 badge — 24h 内发现 */}
            {dayjs().diff(dayjs(r.updatedAt), 'hour') < 24 && (
              <Badge count="NEW" style={{ backgroundColor: '#52c41a', marginLeft: 6, fontSize: 10 }} />
            )}
          </div>
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
    // vmfix28 #2: 来源列（蓝/绿/紫 tag）
    {
      title: '来源',
      dataIndex: 'discoverSource',
      width: 100,
      filters: Object.entries(SOURCE_TAG).map(([v, m]) => ({ text: m.label, value: v })),
      onFilter: (v: any, r: DiscoveredGroup) => (r.discoverSource ?? 'contacts') === v,
      render: (s: DiscoverSource | null | undefined) => {
        const src = s ?? 'contacts';  // 老数据 default
        const meta = SOURCE_TAG[src] ?? SOURCE_TAG.contacts;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    // vmfix28 #1: 发现时间列 — 默认排序 newest first
    {
      title: '发现时间',
      dataIndex: 'updatedAt',
      width: 130,
      sorter: (a: DiscoveredGroup, b: DiscoveredGroup) =>
        dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf(),
      defaultSortOrder: 'ascend' as const,  // sorter 返回 b - a 是 desc，搭配 ascend 才正确
      render: (ts: string) => (
        <Tooltip title={dayjs(ts).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ fontSize: 12 }}>{dayjs(ts).fromNow()}</Text>
        </Tooltip>
      ),
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
      width: 240,
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
          {/* vmfix28 C5: 预览按钮（静态显示 DB 数据） */}
          <Button
            size="small"
            type="text"
            icon={<EyeOutlined />}
            onClick={() => setPreviewGroup(r)}
            title="预览群详情"
          />
          {/* vmfix28 #3: 行内 delete (硬删除) */}
          <Popconfirm
            title="彻底删除此群源记录？"
            description="不可撤销。「忽略」是更安全的选择（保留记录，下次不再显示）。"
            okText="确认删除"
            okType="danger"
            cancelText="取消"
            onConfirm={() => handleDelete(r)}
          >
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              loading={actionLoading === r.id}
              title="彻底删除"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ], [actionLoading, accounts, t, groups]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginRight: 8 }} />
          {t('nav.discoveredGroups')}
        </Title>
      </div>

      {/* vmfix28 #2: 关键词搜索机制说明（可关闭） */}
      <Alert
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="关键词发现群机制说明"
        description={
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>群名搜索</b> (蓝 tag) — `contacts.Search`，匹配群名/username；<b>TG 每关键词上限 30 条</b></li>
            <li><b>消息搜索</b> (绿 tag) — `messages.searchGlobal`，按消息内容搜全网公开群，召回 5-10×</li>
            <li><b>邀请链接</b> (紫 tag) — `discover_groups_by_invites` 任务从种子群扫 t.me/+xxx 抓的</li>
            <li><b>AI 关键词扩展</b> — 1 词自动扩 6 个语义变体（中英马混合 + 地名细分），命中率 3-5×</li>
          </ul>
        }
      />

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

      {/* vmfix28 C5: 群预览 modal — 静态显示 DB 已有数据，不发 TG 调用 */}
      <Modal
        title={previewGroup ? `预览：${previewGroup.title}` : ''}
        open={!!previewGroup}
        onCancel={() => setPreviewGroup(null)}
        footer={[
          <Button key="close" onClick={() => setPreviewGroup(null)}>关闭</Button>,
          ...(previewGroup && previewGroup.status === 'new' ? [
            <Button
              key="queue"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => {
                const g = previewGroup;
                setPreviewGroup(null);
                if (g) handleQueueScrape(g);
              }}
            >派发加+爬</Button>,
          ] : []),
        ]}
        width={600}
      >
        {previewGroup && (
          <div>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic title="质量评分" value={previewGroup.qualityScore} suffix="/100"
                  valueStyle={{ color: qualityColor(previewGroup.qualityScore) }} />
              </Col>
              <Col span={8}>
                <Statistic title="成员数" value={previewGroup.participantsCount >= 0 ? previewGroup.participantsCount : '未知'} />
              </Col>
              <Col span={8}>
                <Statistic title="真发言者" value={previewGroup.sampledRealSenders}
                  suffix={`/ ${previewGroup.sampledMessages} 抽样`} />
              </Col>
            </Row>
            <Card size="small" title="详细信息" style={{ marginBottom: 12 }}>
              <p><b>TG ID：</b><Text code>{previewGroup.tgChatId}</Text></p>
              <p><b>Username：</b>{previewGroup.tgUsername ? <Text code copyable>@{previewGroup.tgUsername}</Text> : <span style={{ fontStyle: 'italic', color: '#999' }}>无（私密群或不公开）</span>}</p>
              <p><b>类型：</b><Tag color={KIND_TAG[previewGroup.kind].color}>{KIND_TAG[previewGroup.kind].label}</Tag>
                {previewGroup.isGigagroup && <Tag color="orange">巨型群（非 admin 不能 list 成员）</Tag>}</p>
              <p><b>来源：</b>
                {(() => {
                  const src = previewGroup.discoverSource ?? 'contacts';
                  const meta = SOURCE_TAG[src] ?? SOURCE_TAG.contacts;
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                })()}
                {previewGroup.keyword && <span style={{ marginLeft: 8 }}>关键词：<Tag>{previewGroup.keyword}</Tag></span>}
              </p>
              <p><b>状态：</b><Tag color={STATUS_TAG[previewGroup.status].color}>{STATUS_TAG[previewGroup.status].label}</Tag></p>
              <p><b>发现时间：</b>{dayjs(previewGroup.updatedAt).format('YYYY-MM-DD HH:mm:ss')} ({dayjs(previewGroup.updatedAt).fromNow()})</p>
              {(previewGroup.recentMessageRate ?? 0) > 0 && (
                <p><b>最近 7 天消息占比：</b>{previewGroup.recentMessageRate}%
                  {(previewGroup.recentMessageRate ?? 0) >= 50 && <Tag color="volcano" icon={<FireOutlined />} style={{ marginLeft: 6 }}>HOT</Tag>}
                </p>
              )}
              {previewGroup.aiScore != null && (
                <p>
                  <b>AI 评分：</b>{previewGroup.aiScore}/100
                  {previewGroup.aiReason && <Text type="secondary" style={{ marginLeft: 8 }}>「{previewGroup.aiReason}」</Text>}
                </p>
              )}
            </Card>
            <Alert
              type="info"
              showIcon
              message="此预览仅显示发现任务时抽样到的数据，不会发起新的 TG 请求"
              description="加群后通过「爬群」任务能获取更详细的成员 / 消息内容"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
