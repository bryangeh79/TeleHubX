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

const STATUS_BADGE: Record<SectionStatus, { color: 'success' | 'warning' | 'error' | 'default' | 'processing'; label: string }> = {
  unknown:  { color: 'default',    label: '未检查' },
  ok:       { color: 'success',    label: '正常' },
  warning:  { color: 'warning',    label: '注意' },
  error:    { color: 'error',      label: '异常' },
  loading:  { color: 'processing', label: '检查中' },
};

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
  const cfg = STATUS_BADGE[status];
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
      antdMessage.error(err?.response?.data?.message ?? '检查失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<UserOutlined style={{ color: '#1677ff' }} />}
        title="账号健康自检 (M1)"
        subtitle="扫描所有账号，标出 health 低分 / 已封禁 / 长时间未上线"
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? '重新检查' : '一键体检'}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>总账号</span>} value={data.stats.total} valueStyle={{ fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>健康</span>} value={data.stats.healthy} valueStyle={{ color: '#52c41a', fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>注意</span>} value={data.stats.warning + data.stats.caution} valueStyle={{ color: '#fa8c16', fontSize: 22 }} /></Col>
            <Col span={6}><Statistic title={<span style={{ fontSize: 13 }}>危急</span>} value={data.stats.critical} valueStyle={{ color: '#cf1322', fontSize: 22 }} /></Col>
          </Row>
          <div style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 14, marginRight: 8 }}>平均健康分:</Text>
            <Progress percent={data.stats.avgScore} size="default" style={{ width: 240 }} status={data.stats.avgScore < 60 ? 'exception' : 'active'} />
          </div>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message={<span style={RESULT_TEXT_FONT}>🎉 所有账号都健康</span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: '手机号', dataIndex: 'phoneNumber', render: (v: string) => <Text style={{ fontSize: 13 }}>{v}</Text> },
                { title: '健康分', dataIndex: 'healthScore', width: 80, render: (v: number) => <Tag color={v < 30 ? 'red' : v < 60 ? 'orange' : 'gold'} style={{ fontSize: 13 }}>{v}</Tag> },
                { title: '原因', dataIndex: 'reason', render: (v: string) => <Text type="warning" style={{ fontSize: 13 }}><WarningOutlined /> {v}</Text> },
                {
                  title: '操作', width: 100,
                  render: (_: any, row: any) => (
                    <Button size="small" type="link" onClick={() => { window.location.href = `/accounts?focus=${row.id}`; }}>
                      去处理
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
      antdMessage.error(err?.response?.data?.message ?? '检查失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<RobotOutlined style={{ color: '#52c41a' }} />}
        title="Bot 长轮询自检 (M2)"
        subtitle="对每个 Bot 调 TG getMe 验证 token + 检查长轮询时效"
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? '重新检查' : '全部检查'}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          {data.bots.length === 0 ? (
            <Empty description={<span style={{ fontSize: 14 }}>还未配置 Bot — 在「智能客服」页注册</span>} />
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
                    : <Text type="secondary" style={{ fontSize: 13 }}>未知</Text>,
                },
                {
                  title: '启用',
                  dataIndex: 'isActive',
                  width: 80,
                  render: (v: boolean) => v
                    ? <Tag color="success" style={{ fontSize: 12 }}>激活</Tag>
                    : <Tag style={{ fontSize: 12 }}>停用</Tag>,
                },
                {
                  title: 'Token',
                  dataIndex: 'tokenOk',
                  width: 130,
                  render: (ok: boolean, row: any) => ok
                    ? <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 12 }}>有效</Tag>
                    : <Tag color="error" icon={<CloseCircleOutlined />} style={{ fontSize: 12 }}>{row.tokenError ?? '失败'}</Tag>,
                },
                {
                  title: '最后轮询',
                  dataIndex: 'lastPollAt',
                  render: (v: string | null, row: any) => {
                    if (!v) return <Text type="secondary" style={{ fontSize: 13 }}>从未</Text>;
                    const ageSec = row.pollAgeSec ?? 0;
                    const sev = ageSec > 120 ? 'error' : ageSec > 60 ? 'warning' : 'success';
                    return (
                      <Space>
                        <Badge status={sev} />
                        <Text style={{ fontSize: 13 }}>{ageSec}s 前</Text>
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
              message={<Text style={RESULT_TEXT_FONT}>检测到 Bot 长轮询超过 2 分钟未刷新</Text>}
              description={<Text style={{ fontSize: 13 }}>可能服务端 BotGateway 已断 — 重启 telehubx-server 进程 (pm2 restart telehubx-server) 即可恢复</Text>}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ── M3: AI Key 测试 ─────────────────────────────────────────────────────
function AiTestCard() {
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
      if (!tid) { antdMessage.warning('未找到 tenantId'); return; }
      const res = await tenantsApi.testAi(tid);
      setTenantResult({ ok: res.data.ok, msg: res.data.message ?? '测试通过' });
    } catch (err: any) {
      setTenantResult({ ok: false, msg: err?.response?.data?.message ?? '测试失败' });
    } finally {
      setTenantLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<KeyOutlined style={{ color: '#722ed1' }} />}
        title="AI Key 测试 (M3)"
        subtitle="测试租户自有 AI Key 是否能正常调用（quota / 网络 / key 失效）"
        status={status}
        action={
          <Button type="primary" icon={<ApiOutlined />} loading={tenantLoading} onClick={testTenant}>
            测试租户 AI
          </Button>
        }
      />
      {tenantResult && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={tenantResult.ok ? 'success' : 'error'}
            showIcon
            message={<Text style={RESULT_TEXT_FONT}>{tenantResult.ok ? '✓ AI 调用正常' : '✗ AI 调用失败'}</Text>}
            description={<Text style={{ fontSize: 13 }}>{tenantResult.msg}</Text>}
          />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          ℹ️ 平台兜底 AI Providers 在「管理面板 → 全局 AI 默认」单独管理与测试
        </Text>
      </div>
    </Card>
  );
}

// ── M4: 代理自检 ────────────────────────────────────────────────────────
function ProxiesDiagnoseCard() {
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
      antdMessage.error(err?.response?.data?.message ?? '检查失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<GlobalOutlined style={{ color: '#fa8c16' }} />}
        title="代理健康自检 (M4)"
        subtitle="列出所有代理状态，单点重测请到「设置 → 代理管理」"
        status={status}
        action={
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
            {data ? '重新检查' : '加载状态'}
          </Button>
        }
      />
      {data && (
        <div style={{ marginTop: 16 }}>
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>总代理</span>} value={data.stats.total} valueStyle={{ fontSize: 22 }} /></Col>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>活跃</span>} value={data.stats.active} valueStyle={{ color: '#52c41a', fontSize: 22 }} /></Col>
            <Col span={8}><Statistic title={<span style={{ fontSize: 13 }}>失效</span>} value={data.stats.dead} valueStyle={{ color: '#cf1322', fontSize: 22 }} /></Col>
          </Row>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message={<span style={RESULT_TEXT_FONT}>🎉 所有代理都活跃</span>} />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              columns={[
                { title: 'Host', render: (_: any, row: any) => <Text code style={{ fontSize: 13 }}>{row.host}:{row.port}</Text> },
                { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'dead' ? 'red' : 'default'} style={{ fontSize: 12 }}>{v}</Tag> },
                { title: '上次错误', dataIndex: 'lastError', render: (v: string | null) => v ? <Text type="warning" style={{ fontSize: 13 }}>{v}</Text> : <Text type="secondary" style={{ fontSize: 13 }}>-</Text> },
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
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (bucketId: string, count: number) => {
    setRetrying(bucketId);
    try {
      const res = await maintenanceApi.retryBucket(bucketId, days);
      antdMessage.success(`已重新派发 ${res.data.retried}/${count} 个任务`);
      void run(days);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '重试失败');
    } finally {
      setRetrying(null);
    }
  };

  const handleDismiss = async (bucketId: string, count: number) => {
    setRetrying(bucketId);
    try {
      const res = await maintenanceApi.dismissBucket(bucketId, days);
      antdMessage.success(`已忽略 ${res.data.dismissed}/${count} 个任务（标记为已暂停）`);
      void run(days);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '忽略失败');
    } finally {
      setRetrying(null);
    }
  };

  const showSample = (sample: string) => {
    Modal.info({
      title: '错误样本（完整 errorMsg）',
      content: <pre style={{ background: '#fafafa', padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>{sample}</pre>,
      width: 700,
    });
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<BugOutlined style={{ color: '#cf1322' }} />}
        title="失败任务诊断 (M5)"
        subtitle="按错误根因聚类，提供针对性修复建议 + 一键重试"
        status={status}
        action={
          <Space>
            <Button size="small" type={days === 1 ? 'primary' : 'default'} loading={loading && days === 1} onClick={() => run(1)}>近 1 天</Button>
            <Button size="small" type={days === 7 ? 'primary' : 'default'} loading={loading && days === 7} onClick={() => run(7)}>近 7 天</Button>
            <Button size="small" type={days === 30 ? 'primary' : 'default'} loading={loading && days === 30} onClick={() => run(30)}>近 30 天</Button>
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
                近 {data.days} 天共 <Text strong>{data.totalFailed}</Text> 个失败任务，归类 <Text strong>{data.summary.length}</Text> 种错误
              </Text>
            }
          />
          {data.summary.length === 0 ? (
            <Empty description={<span style={{ fontSize: 14 }}>🎉 没有失败任务</span>} />
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
                        <Text type="secondary" style={{ fontSize: 11 }}>次失败</Text>
                      </div>
                    </Col>
                    <Col flex="1 1 auto" style={{ minWidth: 0 }}>
                      <Space size={6} wrap style={{ marginBottom: 4 }}>
                        <Tag color={CATEGORY_COLOR[b.category] ?? 'default'} style={{ fontSize: 13, fontWeight: 600 }}>
                          {b.categoryLabel}
                        </Tag>
                        {b.taskTypes.map((t: string) => (
                          <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>
                        ))}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          最近: {dayjs(b.latest).format('MM-DD HH:mm')}
                        </Text>
                      </Space>
                      <Paragraph style={{ margin: '4px 0', fontSize: 13 }}>
                        <Text code style={{ fontSize: 12 }}>{b.sample.length > 100 ? b.sample.slice(0, 100) + '…' : b.sample}</Text>
                        <Button size="small" type="link" onClick={() => showSample(b.sample)} style={{ padding: '0 4px', fontSize: 12 }}>
                          查看完整
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
                          title={`重试 ${b.count} 个任务？`}
                          description={b.retryable ? '会重新派发执行' : '此类错误重试通常无效（可强制）'}
                          okText="重试"
                          cancelText="取消"
                          onConfirm={() => handleRetry(b.bucketId, b.count)}
                          disabled={retrying === b.bucketId}
                        >
                          <Button
                            type="primary"
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={retrying === b.bucketId}
                            disabled={!b.retryable}
                            title={b.retryable ? '一键重试' : '此类错误重试无效'}
                          >
                            重试 {b.count}
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title="忽略这批任务"
                          description="标记为已暂停，从失败列表中移除（不会重新执行）"
                          okText="忽略"
                          cancelText="取消"
                          onConfirm={() => handleDismiss(b.bucketId, b.count)}
                          disabled={retrying === b.bucketId}
                        >
                          <Button size="small" disabled={retrying === b.bucketId}>
                            忽略
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
    if (!accountId) { antdMessage.warning('请先选择账号'); return; }
    setRunning(true);
    setProgress(0);
    setResults(null);
    setOverall(null);
    try {
      const r = await maintenanceApi.selfTest(accountId);
      const taskId: string = r.data?.taskId;
      if (!taskId) throw new Error('未拿到 taskId');

      // 轮询 task 状态 (最多 90s, 每 2s)
      let lastTask: any = null;
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const tr = await tasksApi.get(taskId);
        lastTask = tr.data;
        setProgress(lastTask?.progress ?? 0);
        if (lastTask?.status !== 'running' && lastTask?.status !== 'pending') break;
      }
      if (!lastTask || (lastTask.status !== 'failed' && lastTask.status !== 'done')) {
        throw new Error(`任务超时未完成 (status=${lastTask?.status})`);
      }
      // 解析 errorMsg JSON
      try {
        const parsed = JSON.parse(lastTask.errorMsg ?? '{}');
        setResults(parsed.results ?? []);
        setOverall({ passed: parsed.passed ?? 0, failed: parsed.failed ?? 0 });
      } catch {
        // 不是 JSON → 任务真的失败了 (executor 异常)
        antdMessage.error(`自检任务异常: ${(lastTask.errorMsg ?? '').slice(0, 200)}`);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? err?.message ?? '自检失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card styles={{ body: CARD_BODY_STYLE }}>
      <CardHeader
        icon={<MedicineBoxOutlined style={{ color: '#13c2c2' }} />}
        title="账号自检 (M6)"
        subtitle="派发轻量 RPC 探针，验证账号 + 客户端 + 网络全链路是否能跑通业务任务"
        status={status}
        action={
          <Space>
            <Select
              size="small"
              showSearch
              placeholder="选择账号"
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
              一键自检
            </Button>
          </Space>
        }
      />
      {running && (
        <div style={{ marginTop: 16 }}>
          <Progress percent={progress} status="active" />
          <Text type="secondary" style={{ fontSize: 12 }}>正在跑 6 项 RPC 探针，每项 30s 上限...</Text>
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
                  ? `🎉 全部 ${overall.passed} 项通过 — 此账号已生产就绪`
                  : `⚠️ ${overall?.failed ?? 0} 项失败 / ${(overall?.passed ?? 0) + (overall?.failed ?? 0)} 项总数 — 请看下方失败详情`}
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
