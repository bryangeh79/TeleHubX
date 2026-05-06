import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Typography, Spin, Tag, Steps, Button, Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useThemeMode } from '../hooks/useThemeMode';
import {
  UserOutlined,
  TeamOutlined,
  MessageOutlined,
  SendOutlined,
  ApiOutlined,
  BankOutlined,
  AppstoreOutlined,
  RobotOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { dashboardApi, knowledgeApi, tenantsApi } from '../services/api';
import { useT } from '../i18n';

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

interface SetupStatus {
  hasBotToken: boolean;
  hasCompanyKb: boolean;
  hasProductKb: boolean;
}

interface DashboardData {
  acc: AccountsStats;
  cand: CandidatesStats;
  conv: LeadsStats;
  camp: CampaignsStats;
  setup: SetupStatus;
}

const FALLBACK: DashboardData = {
  acc: { total: 0, byStatus: {}, avgHealthScore: 0 },
  cand: { total: 0, todayNew: 0, unpackedCount: 0, pending: 0, contacted: 0 },
  conv: { botTodayMessageCount: 0, userTodayMessageCount: 0, humanTakeoverCount: 0, pendingCount: 0 },
  camp: { completedCount: 0, runningCount: 0, totalSent: 0, todaySent: 0 },
  setup: { hasBotToken: false, hasCompanyKb: false, hasProductKb: false },
};

export default function DashboardPage() {
  const t = useT();
  const { mode: themeMode } = useThemeMode();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const tRes = await tenantsApi.getDefault().catch(() => null);
        const tenantId: string = tRes?.data?.id ?? '';
        const [acc, cand, conv, camp, bots, companyKbs, productKbs] = await Promise.all([
          dashboardApi.accountsStats().catch(() => ({ data: FALLBACK.acc })),
          tenantId
            ? dashboardApi.candidatesStats(tenantId).catch(() => ({ data: FALLBACK.cand }))
            : Promise.resolve({ data: FALLBACK.cand }),
          dashboardApi.leadsStats(tenantId || undefined).catch(() => ({ data: FALLBACK.conv })),
          dashboardApi.campaignsStats(tenantId || undefined).catch(() => ({ data: FALLBACK.camp })),
          // Setup 引导状态: 真实数据源, 替代旧版"今日有消息才算注册 Bot"的错误判定
          tenantId
            ? tenantsApi.listBots(tenantId).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] }),
          knowledgeApi.listKbs({ type: 'company' }).catch(() => ({ data: [] })),
          knowledgeApi.listKbs({ type: 'product' }).catch(() => ({ data: [] })),
        ]);
        const botArr = Array.isArray(bots.data) ? bots.data : [];
        const companyArr = Array.isArray(companyKbs.data) ? companyKbs.data : [];
        const productArr = Array.isArray(productKbs.data) ? productKbs.data : [];
        setData({
          acc: acc.data,
          cand: cand.data,
          conv: conv.data,
          camp: camp.data,
          setup: {
            hasBotToken: botArr.length > 0,
            hasCompanyKb: companyArr.length > 0,
            hasProductKb: productArr.length > 0,
          },
        });
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

  // ── 新租户引导：5 步完成度 ──
  // 判定改用真实数据源 (tenant_bots / kb_company / kb_product), 之前用"今日是否有客户对话"
  // 等下游活动指标作 heuristic, 配置完成但当天无活动会被误判.
  const nav = useNavigate();
  const steps = [
    { key: 'bot', title: t('dashboard.step.bot'), done: d.setup.hasBotToken, path: '/cs', icon: <ApiOutlined /> },
    { key: 'company', title: t('dashboard.step.company'), done: d.setup.hasCompanyKb, path: '/cs', icon: <BankOutlined /> },
    { key: 'product', title: t('dashboard.step.product'), done: d.setup.hasProductKb, path: '/cs', icon: <AppstoreOutlined /> },
    { key: 'account', title: t('dashboard.step.account'), done: totalAcc > 0, path: '/accounts', icon: <UserOutlined /> },
    { key: 'discover', title: t('dashboard.step.discover'), done: candTotal > 0, path: '/discovered-groups', icon: <RobotOutlined /> },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const completeness = Math.round((doneCount / steps.length) * 100);
  const showOnboarding = completeness < 100 && !loading;

  const isDark = themeMode === 'dark';
  const content = (
    <div>
      <div style={{ marginBottom: 28 }}>
        <Title
          level={2}
          style={{
            margin: 0,
            color: isDark ? '#fff' : undefined,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          {t('page.dashboard.title')}
        </Title>
        <Text style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)', fontSize: 13 }}>
          系统运行总览，关键数据一目了然
        </Text>
      </div>

      {showOnboarding && (
        <Alert
          type={completeness === 0 ? 'info' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            completeness === 0
              ? `👋 ${t('dashboard.welcome')}`
              : `📊 ${t('dashboard.progress', { pct: completeness, done: doneCount, total: steps.length })}`
          }
          description={
            <div style={{ marginTop: 8 }}>
              <Steps
                size="small"
                current={doneCount}
                items={steps.map(s => ({
                  title: <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => nav(s.path)}>{s.title}</Button>,
                  status: s.done ? 'finish' : 'wait',
                  icon: s.done ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : s.icon,
                }))}
              />
            </div>
          }
        />
      )}

      {loading ? <Spin /> : (
        <Row gutter={[16, 16]}>
          {/* card 1: accounts */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><UserOutlined /> {t('nav.accounts')}</span>}
                value={onlineAcc}
                suffix={<Text type="secondary" style={{ fontSize: 14 }}>/ {totalAcc}</Text>}
                valueStyle={{ color: accColor, fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                <Tag color="green" style={{ marginRight: 4 }}>{t('common.online')} {onlineAcc}</Tag>
                {offlineAcc > 0 && <Tag color="default" style={{ marginRight: 4 }}>{t('common.offline')} {offlineAcc}</Tag>}
                {bannedAcc > 0 && <Tag color="red">{t('common.error')} {bannedAcc}</Tag>}
              </div>
            </Card>
          </Col>

          {/* card 2: candidate pool */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><TeamOutlined /> {t('nav.candidates')}</span>}
                value={candTotal}
                valueStyle={{ color: '#1890ff', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {candToday > 0 && <Tag color="blue" style={{ marginRight: 4 }}>+{candToday}</Tag>}
                <Tag color={unpackedRate > 50 ? 'orange' : 'default'}>{t('dashboard.unpacked')} {unpackedRate}%</Tag>
              </div>
            </Card>
          </Col>

          {/* card 3: customer conversations today */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><MessageOutlined /> {t('dashboard.customerConvToday')}</span>}
                value={botToday}
                valueStyle={{ color: '#13c2c2', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {userToday > 0 && <Tag color="cyan" style={{ marginRight: 4 }}>{t('dashboard.newCustomers')} {userToday}</Tag>}
                {humanCount > 0 && <Tag color="orange" style={{ marginRight: 4 }}>🟠 {t('cs.handoff')} {humanCount}</Tag>}
                {pendingCount > 0 && <Tag color="red">⏳ {t('common.pending')} {pendingCount}</Tag>}
                {humanCount === 0 && pendingCount === 0 && userToday === 0 && (
                  <Text type="secondary">{t('common.none')}</Text>
                )}
              </div>
            </Card>
          </Col>

          {/* card 4: successful campaigns */}
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title={<span><SendOutlined /> {t('campaign.successDelivery')}</span>}
                value={adCompleted}
                valueStyle={{ color: '#fa541c', fontSize: 32 }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                {adRunning > 0 && <Tag color="processing" style={{ marginRight: 4 }}>{t('common.running')} {adRunning}</Tag>}
                <Tag color="default" style={{ marginRight: 4 }}>{t('campaign.totalSent')} {adTotalSent}</Tag>
                {adTodaySent > 0 && <Tag color="green">+{adTodaySent}</Tag>}
              </div>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );

  return content;
}
