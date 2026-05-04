import { useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Collapse, Empty, Progress,
  Row, Space, Statistic, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  ApiOutlined, BugOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined, GlobalOutlined, KeyOutlined, ReloadOutlined,
  RobotOutlined, ToolOutlined, UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { maintenanceApi, platformConfigApi, tenantsApi } from '../../services/api';

const { Title, Text } = Typography;

export default function MaintenancePage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          系统维护
        </Title>
        <Text type="secondary">租户自助诊断 — 账号 / Bot / AI / 代理 / 任务 全方位健康检查</Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="按需点击下方各项「检查」按钮 — 默认不自动加载，避免一进页面就发起 5 个网络请求"
      />

      <Collapse
        size="small"
        bordered={false}
        defaultActiveKey={[]}
        items={[
          { key: 'accounts',  label: panelLabel(<UserOutlined />, '账号健康自检 (M1)'),  children: <AccountsDiagnoseSection /> },
          { key: 'bots',      label: panelLabel(<RobotOutlined />, 'Bot 长轮询自检 (M2)'), children: <BotsDiagnoseSection /> },
          { key: 'ai',        label: panelLabel(<KeyOutlined />, 'AI Key 测试 (M3)'),    children: <AiTestSection /> },
          { key: 'proxies',   label: panelLabel(<GlobalOutlined />, '代理健康自检 (M4)'), children: <ProxiesDiagnoseSection /> },
          { key: 'failures',  label: panelLabel(<BugOutlined />, '失败任务诊断 (M5)'),    children: <FailuresSection /> },
        ]}
      />
    </div>
  );
}

function panelLabel(icon: React.ReactNode, text: string) {
  return <Space style={{ fontSize: 14, fontWeight: 500 }}>{icon}{text}</Space>;
}

// ── M1: 账号健康 ────────────────────────────────────────────────────────
function AccountsDiagnoseSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
          {data ? '重新检查' : '一键体检'}
        </Button>
        {data && <Text type="secondary">检查时间 {dayjs().format('HH:mm:ss')}</Text>}
      </Space>
      {data && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={4}><Card size="small"><Statistic title="总账号" value={data.stats.total} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="健康 (≥80)" value={data.stats.healthy} valueStyle={{ color: '#52c41a' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="警告 (60-79)" value={data.stats.warning} valueStyle={{ color: '#faad14' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="注意 (30-59)" value={data.stats.caution} valueStyle={{ color: '#fa8c16' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="危急 (<30)" value={data.stats.critical} valueStyle={{ color: '#cf1322' }} /></Card></Col>
          </Row>
          <Card size="small" style={{ marginBottom: 12 }} bodyStyle={{ padding: '8px 16px' }}>
            <Space>
              <Text strong>平均健康分:</Text>
              <Progress percent={data.stats.avgScore} size="small" style={{ width: 200 }} status={data.stats.avgScore < 60 ? 'exception' : 'active'} />
            </Space>
          </Card>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message="🎉 所有账号都健康" />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              columns={[
                { title: '手机号', dataIndex: 'phoneNumber', width: 160 },
                { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                { title: '健康分', dataIndex: 'healthScore', width: 80, render: (v: number) => <Tag color={v < 30 ? 'red' : v < 60 ? 'orange' : 'gold'}>{v}</Tag> },
                { title: '原因', dataIndex: 'reason', render: (v: string) => <Text type="warning"><WarningOutlined /> {v}</Text> },
                { title: '最后活跃', dataIndex: 'lastSeenAt', width: 130, render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : <Text type="secondary">-</Text> },
                {
                  title: '操作', width: 110,
                  render: (_: any, row: any) => (
                    <Button size="small" type="link" onClick={() => { window.location.href = `/accounts?focus=${row.id}`; }}>
                      重新登录
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
}

// ── M2: Bot 自检 ────────────────────────────────────────────────────────
function BotsDiagnoseSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
          {data ? '重新检查' : '全部检查'}
        </Button>
        {data && <Text type="secondary">检查时间 {dayjs().format('HH:mm:ss')}</Text>}
      </Space>
      {data && (
        data.bots.length === 0 ? (
          <Empty description="还未配置 Bot — 在「智能客服」页注册" />
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
                render: (v: string | null) => v ? <Text code>@{v}</Text> : <Text type="secondary">未知</Text>,
              },
              {
                title: '启用',
                dataIndex: 'isActive',
                width: 80,
                render: (v: boolean) => v ? <Tag color="success">激活</Tag> : <Tag>停用</Tag>,
              },
              {
                title: 'Token 校验',
                dataIndex: 'tokenOk',
                width: 130,
                render: (ok: boolean, row: any) => ok
                  ? <Tag color="success" icon={<CheckCircleOutlined />}>✓ 有效</Tag>
                  : <Tag color="error" icon={<CloseCircleOutlined />}>{row.tokenError ?? '失败'}</Tag>,
              },
              {
                title: '最后轮询',
                dataIndex: 'lastPollAt',
                render: (v: string | null, row: any) => {
                  if (!v) return <Text type="secondary">从未</Text>;
                  const ageSec = row.pollAgeSec ?? 0;
                  const color = ageSec > 120 ? 'red' : ageSec > 60 ? 'orange' : 'green';
                  return (
                    <Space>
                      <Badge status={color === 'red' ? 'error' : color === 'orange' ? 'warning' : 'success'} />
                      <Text style={{ fontSize: 12 }}>{dayjs(v).format('HH:mm:ss')} ({ageSec}s 前)</Text>
                    </Space>
                  );
                },
              },
            ]}
          />
        )
      )}
      {data?.bots?.some((b: any) => b.pollAgeSec !== null && b.pollAgeSec > 120) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="检测到 Bot 长轮询超过 2 分钟未刷新"
          description="可能服务端 BotGateway 已断 — 重启 telehubx-server 进程 (pm2 restart telehubx-server) 即可恢复"
        />
      )}
    </Card>
  );
}

// ── M3: AI Key 测试 ──────────────────────────────────────────────────────
function AiTestSection() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantResult, setTenantResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);

  const loadProviders = async () => {
    setProviderLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        tenantsApi.getDefault(),
        platformConfigApi.listAiProviders().catch(() => ({ data: [] })),
      ]);
      setTenantId(tRes.data?.id ?? null);
      setProviders(Array.isArray(pRes.data) ? pRes.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setProviderLoading(false);
    }
  };

  const testTenant = async () => {
    if (!tenantId) { antdMessage.warning('未找到 tenantId'); return; }
    setTenantLoading(true);
    setTenantResult(null);
    try {
      const res = await tenantsApi.testAi(tenantId);
      setTenantResult({ ok: res.data.ok, msg: res.data.message ?? '测试通过' });
    } catch (err: any) {
      setTenantResult({ ok: false, msg: err?.response?.data?.message ?? '测试失败' });
    } finally {
      setTenantLoading(false);
    }
  };

  const testProvider = async (id: string) => {
    try {
      const res = await platformConfigApi.testAiProvider(id);
      antdMessage.success(res.data.ok ? `✓ ${res.data.message ?? 'OK'}` : `✗ ${res.data.message ?? '失败'}`);
      void loadProviders(); // refresh lastTestStatus
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '测试失败');
    }
  };

  return (
    <Card size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Card size="small" title={<Space><KeyOutlined /> 租户自有 AI Key</Space>}>
          <Space>
            <Button type="primary" icon={<ApiOutlined />} loading={tenantLoading} onClick={() => { void loadProviders(); void testTenant(); }}>
              测试租户 AI
            </Button>
            {tenantResult && (
              <Tag color={tenantResult.ok ? 'success' : 'error'} icon={tenantResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
                {tenantResult.msg}
              </Tag>
            )}
          </Space>
        </Card>

        <Card size="small" title={<Space><CloudServerOutlined /> 平台兜底 AI Providers</Space>}
          extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadProviders} loading={providerLoading}>加载</Button>}
        >
          {providers.length === 0 ? (
            <Empty description="还未配置平台 AI Provider，或当前账号无权限查看" />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={providers}
              pagination={false}
              columns={[
                { title: '类型', dataIndex: 'provider', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                { title: '名称', dataIndex: 'name' },
                { title: '上次测试', width: 130, render: (_: any, row: any) => row.lastTestStatus === 'ok' ? <Tag color="success">OK</Tag> : row.lastTestStatus === 'error' ? <Tag color="error">失败</Tag> : <Tag>未测</Tag> },
                {
                  title: '操作', width: 90,
                  render: (_: any, row: any) => <Button size="small" onClick={() => testProvider(row.id)}>测试</Button>,
                },
              ]}
            />
          )}
        </Card>
      </Space>
    </Card>
  );
}

// ── M4: 代理自检 ────────────────────────────────────────────────────────
function ProxiesDiagnoseSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={run}>
          {data ? '重新检查' : '加载代理状态'}
        </Button>
        <Text type="secondary">单点重测请到「设置中心 → 代理管理」页</Text>
      </Space>
      {data && (
        <>
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={6}><Card size="small"><Statistic title="总代理" value={data.stats.total} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="活跃" value={data.stats.active} valueStyle={{ color: '#52c41a' }} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="失效" value={data.stats.dead} valueStyle={{ color: '#cf1322' }} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="禁用" value={data.stats.disabled} valueStyle={{ color: '#8c8c8c' }} /></Card></Col>
          </Row>
          {data.problems.length === 0 ? (
            <Alert type="success" showIcon message="🎉 所有代理都活跃" />
          ) : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data.problems}
              pagination={false}
              columns={[
                { title: 'Host:Port', render: (_: any, row: any) => <Text code>{row.host}:{row.port}</Text> },
                { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'dead' ? 'red' : 'default'}>{v}</Tag> },
                { title: '上次错误', dataIndex: 'lastError', render: (v: string | null) => v ? <Text type="warning" style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">-</Text> },
                { title: '上次测试', dataIndex: 'lastTestedAt', width: 130, render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : <Text type="secondary">从未</Text> },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
}

// ── M5: 失败任务诊断 ────────────────────────────────────────────────────
function FailuresSection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

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

  return (
    <Card size="small">
      <Space style={{ marginBottom: 12 }}>
        <Button type={days === 1 ? 'primary' : 'default'} size="small" loading={loading && days === 1} onClick={() => run(1)}>近 1 天</Button>
        <Button type={days === 7 ? 'primary' : 'default'} size="small" loading={loading && days === 7} onClick={() => run(7)}>近 7 天</Button>
        <Button type={days === 30 ? 'primary' : 'default'} size="small" loading={loading && days === 30} onClick={() => run(30)}>近 30 天</Button>
      </Space>
      {data && (
        <>
          <Alert
            type={data.totalFailed === 0 ? 'success' : data.totalFailed < 10 ? 'info' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`近 ${data.days} 天共 ${data.totalFailed} 个失败任务，归类 ${data.summary.length} 种错误模式`}
          />
          {data.summary.length === 0 ? (
            <Empty description="🎉 没有失败任务" />
          ) : (
            <Table
              size="small"
              rowKey="errorPattern"
              dataSource={data.summary}
              pagination={false}
              columns={[
                {
                  title: '次数', dataIndex: 'count', width: 80,
                  render: (v: number) => <Tag color={v >= 10 ? 'red' : v >= 3 ? 'orange' : 'default'}>{v}</Tag>,
                },
                { title: '任务类型', dataIndex: 'taskTypes', width: 200, render: (v: string[]) => v.map(t => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>) },
                { title: '错误模式 (聚类)', dataIndex: 'errorPattern', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
                { title: '最近发生', dataIndex: 'latest', width: 130, render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
              ]}
              expandable={{
                expandedRowRender: (row: any) => (
                  <div style={{ background: '#fafafa', padding: 8, fontSize: 12 }}>
                    <Text strong>样本错误信息:</Text>
                    <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{row.sample}</pre>
                  </div>
                ),
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}
