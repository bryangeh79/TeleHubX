import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Typography, Spin, Tag } from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  MessageOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { dashboardApi, tenantsApi } from '../services/api';

const { Title, Text } = Typography;

interface AccountsStats {
  total: number;
  byStatus?: Record<string, number>; // online / offline / banned / cooling 等
  avgHealthScore?: number;
}
interface CandidatesStats {
  total: number;
  todayNew: number;
  unpackedCount: number;
  pending: number;
  contacted: number;
}
interface LeadsStats {
  botTodayMessageCount: number;
  userTodayMessageCount: number;
  humanTakeoverCount: number;
  pendingCount: number;
}
interface CampaignsStats {
  completedCount: number;
  runningCount: number;
  totalSent: number;
  todaySent: number;
}

interface DashboardData {
  acc: AccountsStats;
  cand: CandidatesStats;
  conv: LeadsStats;
  camp: CampaignsStats;
}

const FALLBACK: DashboardData = {
  acc: { total: 0, byStatus: {}, avgHealthScore: 0 },
  cand: { total: 0, todayNew: 0, unpackedCount: 0, pending: 0, contacted: 0 },
  conv: { botTodayMessageCount: 0, userTodayMessageCount: 0, humanTakeoverCount: 0, pendingCount: 0 },
  camp: { completedCount: 0, runningCount: 0, totalSent: 0, todaySent: 0 },
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const tRes = await tenantsApi.getDefault().catch(() => null);
        const tenantId: string = tRes?.data?.id ?? '';
        const [acc, cand, conv, camp] = await Promise.all([
          dashboardApi.accountsStats().catch(() => ({ data: FALLBACK.acc })),
          tenantId
            ? dashboardApi.candidatesStats(tenantId).catch(() => ({ data: FALLBACK.cand }))
            : Promise.resolve({ data: FALLBACK.cand }),
          dashboardApi.leadsStats(tenantId || undefined).catch(() => ({ data: FALLBACK.conv })),
          dashboardApi.campaignsStats(tenantId || undefined).catch(() => ({ data: FALLBACK.camp })),
        ]);
        setData({ acc: acc.data, cand: cand.data, conv: conv.data, camp: camp.data });
      } catch {
        setData(FALLBACK);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const d = data ?? FALLBACK;

  // ── 账号 ──
  const totalAcc = d.acc.total ?? 0;
  const onlineAcc = d.acc.byStatus?.online ?? 0;
  const offlineAcc = d.acc.byStatus?.offline ?? 0;
  const bannedAcc = (d.acc.byStatus?.banned ?? 0) + (d.acc.byStatus?.cooling ?? 0) + (d.acc.byStatus?.quarantined ?? 0);
  const accColor = onlineAcc / Math.max(totalAcc, 1) >= 0.8 ? '#52c41a' : onlineAcc > 0 ? '#faad14' : '#ff4d4f';

  // ── 候选人池 ──
  const candTotal = d.cand.total ?? 0;
  const candToday = d.cand.todayNew ?? 0;
  const candUnpacked = d.cand.unpackedCount ?? 0;
  const unpackedRate = candTotal > 0 ? Math.round((candUnpacked / candTotal) * 100) : 0;

  // ── 客户对话 ──
  const botToday = d.conv.botTodayMessageCount ?? 0;
  const userToday = d.conv.userTodayMessageCount ?? 0;
  const humanCount = d.conv.humanTakeoverCount ?? 0;
  const pendingCount = d.conv.pendingCount ?? 0;

  // ── 广告 ──
  const adCompleted = d.camp.completedCount ?? 0;
  const adRunning = d.camp.runningCount ?? 0;
  const adTotalSent = d.camp.totalSent ?? 0;
  const adTodaySent = d.camp.todaySent ?? 0;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>仪表盘</Title>

      {loading ? <Spin /> : (
        <Row gutter={[16, 16]}>
          {/* 卡 1: 账号 */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><UserOutlined /> 账号</span>}
                value={onlineAcc}
                suffix={<Text type="secondary" style={{ fontSize: 14 }}>/ {totalAcc}</Text>}
                valueStyle={{ color: accColor, fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                <Tag color="green" style={{ marginRight: 4 }}>在线 {onlineAcc}</Tag>
                {offlineAcc > 0 && <Tag color="default" style={{ marginRight: 4 }}>离线 {offlineAcc}</Tag>}
                {bannedAcc > 0 && <Tag color="red">异常 {bannedAcc}</Tag>}
              </div>
            </Card>
          </Col>

          {/* 卡 2: 候选人池 */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><TeamOutlined /> 候选人池</span>}
                value={candTotal}
                suffix={<Text type="secondary" style={{ fontSize: 14 }}>人</Text>}
                valueStyle={{ color: '#1890ff', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {candToday > 0 && <Tag color="blue" style={{ marginRight: 4 }}>今日 +{candToday}</Tag>}
                <Tag color={unpackedRate > 50 ? 'orange' : 'default'}>未打包 {unpackedRate}%</Tag>
              </div>
            </Card>
          </Col>

          {/* 卡 3: 客户对话 */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><MessageOutlined /> 客户对话 (今日)</span>}
                value={botToday}
                suffix={<Text type="secondary" style={{ fontSize: 14 }}>条</Text>}
                valueStyle={{ color: '#13c2c2', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {userToday > 0 && <Tag color="cyan" style={{ marginRight: 4 }}>客户来 {userToday}</Tag>}
                {humanCount > 0 && <Tag color="orange" style={{ marginRight: 4 }}>🟠 人工 {humanCount}</Tag>}
                {pendingCount > 0 && <Tag color="red">⏳ 待处理 {pendingCount}</Tag>}
                {humanCount === 0 && pendingCount === 0 && userToday === 0 && (
                  <Text type="secondary">今日无新对话</Text>
                )}
              </div>
            </Card>
          </Col>

          {/* 卡 4: 成功广告投放 */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><SendOutlined /> 成功广告投放</span>}
                value={adCompleted}
                suffix={<Text type="secondary" style={{ fontSize: 14 }}>个</Text>}
                valueStyle={{ color: '#fa541c', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {adRunning > 0 && <Tag color="processing" style={{ marginRight: 4 }}>运行中 {adRunning}</Tag>}
                <Tag color="default" style={{ marginRight: 4 }}>累计已发 {adTotalSent}</Tag>
                {adTodaySent > 0 && <Tag color="green">今日 +{adTodaySent}</Tag>}
              </div>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
