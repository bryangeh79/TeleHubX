import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Empty, List, Modal, Popconfirm, Progress,
  Row, Select, Space, Statistic, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  ApiOutlined, BugOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined, ExclamationCircleOutlined, GlobalOutlined,
  KeyOutlined, MedicineBoxOutlined, ReloadOutlined, RobotOutlined, ToolOutlined,
  UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { accountsApi, maintenanceApi, platformConfigApi, tasksApi, tenantsApi } from '../../services/api';
import { useT } from '../../i18n';

const { Title, Text, Paragraph } = Typography;

// 卡片整体风格常量
const CARD_BODY_STYLE = { padding: 20 };
const SECTION_TITLE_FONT = { fontSize: 16, fontWeight: 600 };
const RESULT_TEXT_FONT = { fontSize: 14 };

type SectionStatus = 'unknown' | 'ok' | 'warning' | 'error' | 'loading';

function buildStatusBadge(t: (k: string) => string): Record<SectionStatus, { color: 'success' | 'warning' | 'error' | 'default' | 'processing'; label: string }> {
  return {
    unknown:  { color: 'default',    label: t('maint.status.unknown') },
    ok:       { color: 'success',    label: t('maint.status.ok') },
    warning:  { color: 'warning',    label: t('maint.status.warning') },
    error:    { color: 'error',      label: t('maint.status.error') },
    loading:  { color: 'processing', label: t('maint.status.loading') },
  };
}

export default function MaintenancePage() {
  const t = useT();
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          {t('page.maintenance.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 14 }}>
          {t('page.maintenance.subtitle')}
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20, fontSize: 14 }}
        message={t('page.maintenance.tip')}
      />

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={12}><AccountsDiagnoseCard /></Col>
        <Col xs={24} lg={12}><BotsDiagnoseCard /></Col>
        <Col xs={24} lg={12}><AiTestCard /></Col>
        <Col xs={24} lg={12}><ProxiesDiagnoseCard /></Col>
        <Col xs={24}><SelfTestCard /></Col>
        <Col xs={24}><FailuresCard /></Col>
      </Row>
    </div>
  );
}

// ── 卡片头部统一渲染 ────────────────────────────────────────────────────
function CardHeader({
  icon, title, subtitle, status, action,
}: {
  icon: React.ReactNode; title: string; subtitle: string;
  status: SectionStatus; action?: React.ReactNode;
}) {
  const t = useT();
  const cfg = buildStatusBadge(t)[status];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={10} style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <Text style={SECTION_TITLE_FONT}>{title}</Text>
          <Badge status={cfg.color} text={<Text style={{ fontSize: 13 }}>{cfg.label}</Text>} />
        </Space>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{subtitle}</Text>
        </div>
      </div>
      <div>{action}</div>
    </div>
  );
}

// ── M1: 账号健康 ────────────────────────────────────────────────────────
function AccountsDiagnoseCard() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const status: SectionStatus = loading ? 'loading' :
    !data ? 'unknown' :
    data.problems.length === 0 ? 'ok' :
    data.stats.critical > 0 ? 'error' : 'warning';

  const run = async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.diagnoseAccounts();
      setData(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.checkFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<UserOutlined style={{ color: '#1677ff' }} />}
        title={t('maint.m1.title')}
        subtitle={t('maint.m1.subtitle')}
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? t('maint.m1.recheck') : t('maint.m1.run')}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m1.statTotal')}</span>} value={data.stats.total} valueStyle={{ fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m1.statHealthy')}</span>} value={data.stats.healthy} valueStyle={{ color: '#52c41a', fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m1.statWarning')}</span>} value={data.stats.warning + data.stats.caution} valueStyle={{ color: '#fa8c16', fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m1.statCritical')}</span>} value={data.stats.critical} valueStyle={{ color: '#cf1322', fontSize: 22 }} /></Col>
          </Row>
          <div style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 14, marginRight: 8 }}>{t('maint.m1.avgScore')}</Text>
            <Progress percent={data.stats.avgScore} size="default" style={{ width: 240 }} status={data.stats.avgScore < 60 ? 'exception' : 'active'} />
          </div>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message={<span style={RESULT_TEXT_FONT}>{t('maint.m1.allHealthy')}</span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: t('maint.m1.colPhone'), dataIndex: 'phoneNumber', render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text> },
                { title: t('maint.m1.colScore'), dataIndex: 'healthScore', width: 80, render: (v: number) => <Tag color={v < 30 ? 'red' : v < 60 ? 'orange' : 'gold'} style={{ fontSize: 13 }}>{v}</Tag> },
                { title: t('maint.m1.colReason'), dataIndex: 'reason', render: (v: string) => <Text type="warning" style={{ fontSize: 13 }}><WarningOutlined /> {v}</Text> },
                {
                  title: t('maint.m1.colAction'), width: 100,
                  render: (_: any, row: any) => (
                    <Button size="small" type="link" onClick={() => { window.location.href = `/accounts?focus=${row.id}`; }}>
                      {t('maint.m1.go')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ── M2: Bot 自检 ────────────────────────────────────────────────────────
function BotsDiagnoseCard() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const stale = data?.bots?.some((b: any) => b.pollAgeSec !== null && b.pollAgeSec > 120);
  const tokenBad = data?.bots?.some((b: any) => !b.tokenOk);
  const status: SectionStatus = loading ? 'loading' :
    !data ? 'unknown' :
    data.bots.length === 0 ? 'unknown' :
    tokenBad ? 'error' : stale ? 'warning' : 'ok';

  const run = async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.diagnoseBots();
      setData(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.checkFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<RobotOutlined style={{ color: '#52c41a' }} />}
        title={t('maint.m2.title')}
        subtitle={t('maint.m2.subtitle')}
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? t('maint.m2.recheck') : t('maint.m2.run')}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          {data.bots.length === 0 ? (
            <Empty description={<span style={{ fontSize: 14 }}>{t('maint.m2.empty')}</span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.bots}
              pagination={false}
              columns={[
                {
                  title: 'Bot',
                  dataIndex: 'botUsername',
                  render: (v: string | null) => v
                    ? <Text code style={{ fontSize: 13 }}>@{v}</Text>
                    : <Text type="secondary" style={{ fontSize: 13 }}>{t('maint.m2.unknown')}</Text>,
                },
                {
                  title: t('maint.m2.colEnabled'),
                  dataIndex: 'isActive',
                  width: 80,
                  render: (v: boolean) => v
                    ? <Tag color="success" style={{ fontSize: 12 }}>{t('maint.m2.tagActive')}</Tag>
                    : <Tag style={{ fontSize: 12 }}>{t('maint.m2.tagPaused')}</Tag>,
                },
                {
                  title: 'Token',
                  dataIndex: 'tokenOk',
                  width: 130,
                  render: (ok: boolean, row: any) => ok
                    ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 12 }}>{t('maint.m2.tagValid')}</Tag>
                    : <Tag color="error" icon={<CloseCircleOutlined />} style={{ fontSize: 12 }}>{row.tokenError ?? t('maint.m2.tagFailed')}</Tag>,
                },
                {
                  title: t('maint.m2.colLastPoll'),
                  dataIndex: 'lastPollAt',
                  render: (v: string | null, row: any) => {
                    if (!v) return <Text type="secondary" style={{ fontSize: 13 }}>{t('maint.m2.never')}</Text>;
                    const ageSec = row.pollAgeSec ?? 0;
                    const sev = ageSec > 120 ? 'error' : ageSec > 60 ? 'warning' : 'success';
                    return (
                      <Space>
                        <Badge status={sev} />
                        <Text style={{ fontSize: 13 }}>{t('maint.m2.ago', { n: ageSec })}</Text>
                      </Space>
                    );
                  },
                },
              ]}
            />
          )}
          {stale && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12, fontSize: 13 }}
              message={<Text style={RESULT_TEXT_FONT}>{t('maint.m2.staleTitle')}</Text>}
              description={<Text style={{ fontSize: 13 }}>{t('maint.m2.staleDesc')}</Text>}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ── M3: AI Key 测试 ─────────────────────────────────────────────────────
function AiTestCard() {
  const t = useT();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantResult, setTenantResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);

  const status: SectionStatus = tenantLoading ? 'loading' :
    !tenantResult ? 'unknown' : tenantResult.ok ? 'ok' : 'error';

  const testTenant = async () => {
    setTenantLoading(true);
    setTenantResult(null);
    try {
      let tid = tenantId;
      if (!tid) {
        const tRes = await tenantsApi.getDefault();
        tid = tRes.data?.id ?? null;
        setTenantId(tid);
      }
      if (!tid) { antdMessage.warning(t('maint.m3.noTenant')); return; }
      const res = await tenantsApi.testAi(tid);
      setTenantResult({ ok: res.data.ok, msg: res.data.message ?? t('maint.m3.passDefault') });
    } catch (err: any) {
      setTenantResult({ ok: false, msg: err?.response?.data?.message ?? t('maint.m3.failDefault') });
    } finally {
      setTenantLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<KeyOutlined style={{ color: '#722ed1' }} />}
        title={t('maint.m3.title')}
        subtitle={t('maint.m3.subtitle')}
        status={status}
        action={
          <Button type="primary" icon={<ApiOutlined />} loading={tenantLoading} onClick={testTenant}>
            {t('maint.m3.run')}
          </Button>
        }
      />
      {tenantResult && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={tenantResult.ok ? 'success' : 'error'}
            showIcon
            message={<Text style={RESULT_TEXT_FONT}>{tenantResult.ok ? t('maint.m3.ok') : t('maint.m3.fail')}</Text>}
            description={<Text style={{ fontSize: 13 }}>{tenantResult.msg}</Text>}
          />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('maint.m3.platformNote')}
        </Text>
      </div>
    </Card>
  );
}

// ── M4: 代理自检 ────────────────────────────────────────────────────────
function ProxiesDiagnoseCard() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const status: SectionStatus = loading ? 'loading' :
    !data ? 'unknown' :
    data.problems.length === 0 ? 'ok' :
    data.stats.dead > 0 ? 'error' : 'warning';

  const run = async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.diagnoseProxies();
      setData(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.checkFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<GlobalOutlined style={{ color: '#fa8c16' }} />}
        title={t('maint.m4.title')}
        subtitle={t('maint.m4.subtitle')}
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? t('maint.m4.recheck') : t('maint.m4.run')}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m4.statTotal')}</span>} value={data.stats.total} valueStyle={{ fontSize: 22 }} /></Col>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m4.statActive')}</span>} value={data.stats.active} valueStyle={{ color: '#52c41a', fontSize: 22 }} /></Col>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>{t('maint.m4.statDead')}</span>} value={data.stats.dead} valueStyle={{ color: '#cf1322', fontSize: 22 }} /></Col>
          </Row>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message={<span style={RESULT_TEXT_FONT}>{t('maint.m4.allActive')}</span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              columns={[
                { title: 'Host', render: (_: any, row: any) => <Text code style={{ fontSize: 13 }}>{row.host}:{row.port}</Text> },
                { title: t('maint.m4.colStatus'), dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'dead' ? 'red' : 'default'} style={{ fontSize: 12 }}>{v}</Tag> },
                { title: t('maint.m4.colLastError'), dataIndex: 'lastError', render: (v: string | null) => v ? <Text type="warning" style={{ fontSize: 13 }}>{v}</Text> : <Text type="secondary" style={{ fontSize: 13 }}>-</Text> },
              ]}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ── M5: 失败任务诊断 ────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  network_timeout: 'orange',
  flood_wait: 'red',
  entity_not_found: 'gold',
  agent_offline: 'red',
  auth_session: 'red',
  permission_denied: 'magenta',
  business_zero: 'default',
  config: 'purple',
  unknown: 'default',
};

function FailuresCard() {
  const t = useT();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [retrying, setRetrying] = useState<string | null>(null);

  const status: SectionStatus = loading ? 'loading' :
    !data ? 'unknown' :
    data.totalFailed === 0 ? 'ok' :
    data.totalFailed > 50 ? 'error' : 'warning';

  const run = async (d: number) => {
    setDays(d);
    setLoading(true);
    try {
      const res = await maintenanceApi.failureSummary(d);
      setData(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (bucketId: string, count: number) => {
    setRetrying(bucketId);
    try {
      const res = await maintenanceApi.retryBucket(bucketId, days);
      antdMessage.success(t('maint.m5.retriedOk', { ok: res.data.retried, total: count }));
      void run(days);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.m5.retryFail'));
    } finally {
      setRetrying(null);
    }
  };

  const handleDismiss = async (bucketId: string, count: number) => {
    setRetrying(bucketId);
    try {
      const res = await maintenanceApi.dismissBucket(bucketId, days);
      antdMessage.success(t('maint.m5.dismissedOk', { ok: res.data.dismissed, total: count }));
      void run(days);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('maint.m5.dismissFail'));
    } finally {
      setRetrying(null);
    }
  };

  const showSample = (sample: string) => {
    Modal.info({
      title: t('maint.m5.errorSampleTitle'),
      content: <pre style={{ background: '#fafafa', padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{sample}</pre>,
      width: 700,
    });
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<BugOutlined style={{ color: '#cf1322' }} />}
        title={t('maint.m5.title')}
        subtitle={t('maint.m5.subtitle')}
        status={status}
        action={
          <Space>
            <Button size="small" type={days === 1 ? 'primary' : 'default'} loading={loading && days === 1} onClick={() => run(1)}>{t('maint.m5.day1')}</Button>
            <Button size="small" type={days === 7 ? 'primary' : 'default'} loading={loading && days === 7} onClick={() => run(7)}>{t('maint.m5.day7')}</Button>
            <Button size="small" type={days === 30 ? 'primary' : 'default'} loading={loading && days === 30} onClick={() => run(30)}>{t('maint.m5.day30')}</Button>
          </Space>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={data.totalFailed === 0 ? 'success' : data.totalFailed < 10 ? 'info' : 'warning'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <Text style={RESULT_TEXT_FONT}>
                {t('maint.m5.summary', { days: data.days, totalFailed: data.totalFailed, clusters: data.summary.length })}
              </Text>
            }
          />
          {data.summary.length === 0 ? (
            <Empty description={<span style={{ fontSize: 14 }}>{t('maint.m5.empty')}</span>} />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {data.summary.map((b: any) => (
                <Card
                  key={b.bucketId}
                  size="small"
                  styles={{ body: { padding: 14 } }}
                  style={{ borderLeft: `3px solid ${b.retryable ? '#1677ff' : '#bfbfbf'}` }}
                >
                  <Row gutter={12} align="middle">
                    <Col flex="0 0 auto">
                      <div style={{ textAlign: 'center', minWidth: 60 }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: b.count >= 10 ? '#cf1322' : b.count >= 3 ? '#fa8c16' : '#1677ff' }}>
                          {b.count}
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{t('maint.m5.failures')}</Text>
                      </div>
                    </Col>
                    <Col flex="1 1 auto" style={{ minWidth: 0 }}>
                      <Space size={6} wrap style={{ marginBottom: 4 }}>
                        <Tag color={CATEGORY_COLOR[b.category] ?? 'default'} style={{ fontSize: 13, fontWeight: 600 }}>
                          {b.categoryLabel}
                        </Tag>
                        {b.taskTypes.map((tt: string) => (
                          <Tag key={tt} style={{ fontSize: 11 }}>{tt}</Tag>
                        ))}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('maint.m5.latest', { time: dayjs(b.latest).format('MM-DD HH:mm') })}
                        </Text>
                      </Space>
                      <Paragraph style={{ margin: '4px 0', fontSize: 13 }}>
                        <Text code style={{ fontSize: 12 }}>{b.sample.length > 100 ? b.sample.slice(0, 100) + '…' : b.sample}</Text>
                        <Button size="small" type="link" onClick={() => showSample(b.sample)} style={{ padding: '0 4px', fontSize: 12 }}>
                          {t('maint.m5.viewFull')}
                        </Button>
                      </Paragraph>
                      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', padding: '6px 10px', borderRadius: 4, marginTop: 6 }}>
                        <Space size={6}>
                          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                          <Text style={{ fontSize: 13 }}>{b.hint}</Text>
                        </Space>
                      </div>
                    </Col>
                    <Col flex="0 0 auto">
                      <Space direction="vertical" size={4}>
                        <Popconfirm
                          title={t('maint.m5.retryConfirmTitle', { count: b.count })}
                          description={b.retryable ? t('maint.m5.retryConfirmYes') : t('maint.m5.retryConfirmNo')}
                          okText={t('maint.m5.retry')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleRetry(b.bucketId, b.count)}
                          disabled={retrying === b.bucketId}
                        >
                          <Button
                            type="primary"
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={retrying === b.bucketId}
                            disabled={!b.retryable}
                            title={b.retryable ? t('maint.m5.retryTooltipYes') : t('maint.m5.retryTooltipNo')}
                          >
                            {t('maint.m5.retryBtn', { count: b.count })}
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title={t('maint.m5.dismissTitle')}
                          description={t('maint.m5.dismissDesc')}
                          okText={t('maint.m5.dismiss')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleDismiss(b.bucketId, b.count)}
                          disabled={retrying === b.bucketId}
                        >
                          <Button size="small" disabled={retrying === b.bucketId}>
                            {t('maint.m5.dismiss')}
                          </Button>
                        </Popconfirm>
                      </Space>
                    </Col>
                  </Row>
                </Card>
              ))}
            </Space>
          )}
        </div>
      )}
    </Card>
  );
}

// ── M6: 账号自检 (Self-test) ────────────────────────────────────────────
/**
 * 派发 SELF_TEST 任务到选中账号 → polling 任务 status → 解析 errorMsg JSON 展示结果。
 *
 * 6 项检查：getMe / UpdateStatus / GetDialogs / contacts.Search / getEntity / getMessages
 * 是否成功不看 task.status (SELF_TEST 总是会走 throw 标 failed), 而看 errorMsg JSON 里的 failed=0
 */
function SelfTestCard() {
  const t = useT();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [results, setResults] = useState<any[] | null>(null);
  const [overall, setOverall] = useState<{ passed: number; failed: number } | null>(null);

  useEffect(() => {
    accountsApi.list({ limit: 200 }).then((r) => {
      const arr = Array.isArray(r.data) ? r.data : [];
      setAccounts(arr);
    }).catch(() => {});
  }, []);

  const status: SectionStatus = running ? 'loading' :
    !overall ? 'unknown' :
    overall.failed === 0 ? 'ok' : 'error';

  const run = async () => {
    if (!accountId) { antdMessage.warning(t('maint.m6.pickAccountWarn')); return; }
    setRunning(true);
    setProgress(0);
    setResults(null);
    setOverall(null);
    try {
      const r = await maintenanceApi.selfTest(accountId);
      const taskId: string = r.data?.taskId;
      if (!taskId) throw new Error(t('maint.m6.noTaskId'));

      let lastTask: any = null;
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const tr = await tasksApi.get(taskId);
        lastTask = tr.data;
        setProgress(lastTask?.progress ?? 0);
        if (lastTask?.status !== 'running' && lastTask?.status !== 'pending') break;
      }
      if (!lastTask || (lastTask.status !== 'failed' && lastTask.status !== 'done')) {
        throw new Error(t('maint.m6.timeoutErr', { status: lastTask?.status ?? '' }));
      }
      try {
        const parsed = JSON.parse(lastTask.errorMsg ?? '{}');
        setResults(parsed.results ?? []);
        setOverall({ passed: parsed.passed ?? 0, failed: parsed.failed ?? 0 });
      } catch {
        antdMessage.error(t('maint.m6.executorErr', { tail: (lastTask.errorMsg ?? '').slice(0, 200) }));
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? err?.message ?? t('maint.m6.failDefault'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<MedicineBoxOutlined style={{ color: '#13c2c2' }} />}
        title={t('maint.m6.title')}
        subtitle={t('maint.m6.subtitle')}
        status={status}
        action={
          <Space>
            <Select
              size="small"
              showSearch
              placeholder={t('maint.m6.pickAccount')}
              style={{ width: 220 }}
              value={accountId}
              onChange={setAccountId}
              filterOption={(input, opt) =>
                String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={accounts.map((a) => ({
                value: a.id,
                label: `${a.phoneNumber} (${a.role}, health=${a.healthScore})`,
              }))}
              disabled={running}
            />
            <Button type="primary" icon={<MedicineBoxOutlined />} loading={running} onClick={run}>
              {t('maint.m6.run')}
            </Button>
          </Space>
        }
      />
      {running && (
        <div style={{ marginTop: 16 }}>
          <Progress percent={progress} status="active" />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('maint.m6.runHint')}</Text>
        </div>
      )}
      {!running && results && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={overall && overall.failed === 0 ? 'success' : 'error'}
            showIcon
            style={{ marginBottom: 14 }}
            message={
              <Text style={RESULT_TEXT_FONT}>
                {overall && overall.failed === 0
                  ? t('maint.m6.allPass', { n: overall.passed })
                  : t('maint.m6.someFail', { failed: overall?.failed ?? 0, total: (overall?.passed ?? 0) + (overall?.failed ?? 0) })}
              </Text>
            }
          />
          <List
            size="small"
            bordered
            dataSource={results}
            renderItem={(r: any) => (
              <List.Item>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    {r.ok
                      ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                      : <CloseCircleOutlined style={{ color: '#cf1322', fontSize: 16 }} />}
                    <Text style={{ fontSize: 13 }}>{r.label}</Text>
                  </Space>
                  <Space>
                    <Tag color={r.durationMs < 1000 ? 'green' : r.durationMs < 5000 ? 'gold' : 'red'} style={{ fontSize: 11 }}>
                      {r.durationMs} ms
                    </Tag>
                    {!r.ok && r.error && (
                      <Text type="danger" style={{ fontSize: 12, maxWidth: 400 }} ellipsis={{ tooltip: r.error }}>
                        {r.error}
                      </Text>
                    )}
                  </Space>
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}
    </Card>
  );
}
