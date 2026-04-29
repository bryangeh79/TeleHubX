import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Descriptions,
  Tag,
  Badge,
  Button,
  Space,
  Typography,
  Spin,
  Empty,
  Form,
  Select,
  InputNumber,
  Modal,
  Timeline,
  Alert,
  Statistic,
  Row,
  Col,
  Tooltip,
  message as antdMessage,
} from 'antd';
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  HeartOutlined,
  EditOutlined,
  PlayCircleOutlined,
  StepForwardOutlined,
  PauseCircleOutlined,
  RedoOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { accountsApi, slotsApi, warmupApi, proxiesApi } from '../../services/api';

const { Title, Text } = Typography;

type Role = 'cs' | 'ad' | 'hybrid';
type Status = 'online' | 'offline' | 'connecting' | 'error' | 'banned';

interface Account {
  id: string;
  phoneNumber: string;
  role: Role;
  status: Status;
  warmupPhase: number;
  healthScore: number;
  lastActiveAt: string | null;
  boundIp: string | null;
  sessionEncrypted: boolean;
  proxyId: string | null;
  proxyConfig: any;
  createdAt: string;
  updatedAt: string;
}

interface WarmupPlan {
  id: string;
  accountId: string;
  currentPhase: number;
  phaseStartedAt: Record<string, string>;
  actionsLog: Array<{ phase: number; action: string; ts: string }>;
  completed: boolean;
  paused?: boolean;
  pausedAt?: string | null;
}

interface SlotInfo {
  id: string;
  no: number;
  status: string;
}

const PHASE_LABEL: Record<number, string> = {
  0: 'P0 Init', 1: 'P1 Silent', 2: 'P2 Lite', 3: 'P3 Social', 4: 'P4 Normal',
};

export default function AccountDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [account, setAccount] = useState<Account | null>(null);
  const [warmup, setWarmup] = useState<WarmupPlan | null>(null);
  const [slot, setSlot] = useState<SlotInfo | null>(null);
  const [proxyName, setProxyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [editForm] = Form.useForm<{ role: Role }>();
  const [healthForm] = Form.useForm<{ healthScore: number; remark?: string }>();

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [a, w, ss] = await Promise.all([
        accountsApi.get(id).catch(() => null),
        warmupApi.status(id).catch(() => null),
        slotsApi.list().catch(() => null),
      ]);
      const acc = a?.data ?? null;
      setAccount(acc);
      setWarmup(w?.data ?? null);
      const ms = Array.isArray(ss?.data) ? ss!.data.find((x: any) => x.account?.id === id) : null;
      setSlot(ms ? { id: ms.id, no: ms.no, status: ms.status } : null);

      if (acc?.proxyId) {
        try {
          const p = await proxiesApi.get(acc.proxyId);
          setProxyName(p.data?.name ?? null);
        } catch {
          setProxyName(null);
        }
      } else {
        setProxyName(null);
      }
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load account');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleEditRole = async () => {
    if (!id) return;
    try {
      const values = await editForm.validateFields();
      await accountsApi.update(id, { role: values.role });
      antdMessage.success('Role updated');
      setEditOpen(false);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      if (msg) antdMessage.error(typeof msg === 'string' ? msg : msg.join('; '));
    }
  };

  const handleReportHealth = async () => {
    if (!id) return;
    try {
      const values = await healthForm.validateFields();
      await accountsApi.reportHealth(id, values.healthScore, values.remark);
      antdMessage.success('Health reported');
      setHealthOpen(false);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Report failed');
    }
  };

  const handleStart = async () => {
    if (!id) return;
    try {
      await warmupApi.start(id);
      antdMessage.success('Warmup started');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Start failed');
    }
  };
  const handleAdvance = async () => {
    if (!id) return;
    try {
      await warmupApi.advance(id);
      antdMessage.success('Advanced');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Advance failed');
    }
  };
  const handlePause = async () => {
    if (!id) return;
    try {
      await warmupApi.pause(id);
      antdMessage.warning('Paused');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Pause failed');
    }
  };
  const handleResume = async () => {
    if (!id) return;
    try {
      await warmupApi.resume(id);
      antdMessage.success('Resumed');
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Resume failed');
    }
  };

  if (loading && !account) {
    return <Spin />;
  }

  if (!account) {
    return (
      <div>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounts')}>Back</Button>
        <Empty description="Account not found" style={{ marginTop: 40 }} />
      </div>
    );
  }

  const healthColor = account.healthScore >= 80 ? '#52c41a'
    : account.healthScore >= 60 ? '#faad14'
    : account.healthScore >= 30 ? '#fa8c16' : '#f5222d';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/accounts')}>Back</Button>
          <Title level={4} style={{ margin: 0 }}>
            {slot ? `No.${String(slot.no).padStart(2, '0')} · ` : ''}{account.phoneNumber}
          </Title>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>Refresh</Button>
          <Button icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue({ role: account.role }); setEditOpen(true); }}>
            Edit Role
          </Button>
          <Button icon={<HeartOutlined />} onClick={() => { healthForm.setFieldsValue({ healthScore: account.healthScore }); setHealthOpen(true); }}>
            Report Health
          </Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Status"
              value={account.status}
              valueStyle={{ color: account.status === 'online' ? '#52c41a' : '#8c8c8c', textTransform: 'capitalize' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Health"
              value={account.healthScore}
              suffix="/ 100"
              valueStyle={{ color: healthColor }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Warmup"
              value={PHASE_LABEL[account.warmupPhase] ?? `P${account.warmupPhase}`}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Last Active"
              value={account.lastActiveAt ? dayjs(account.lastActiveAt).format('MM-DD HH:mm:ss') : '—'}
              valueStyle={{ fontSize: 16 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="Identity & Config" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Account UUID">
                <Text code style={{ fontSize: 11 }}>{account.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Phone">
                <Text code>{account.phoneNumber}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Role">
                <Tag color={account.role === 'cs' ? 'blue' : account.role === 'ad' ? 'green' : 'orange'}>
                  {account.role.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Slot">
                {slot ? `No.${String(slot.no).padStart(2, '0')} (${slot.status})` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Session">
                {account.sessionEncrypted ? (
                  <Tag color="green" icon={<LockOutlined />}>encrypted (AES-256-GCM)</Tag>
                ) : (
                  <Tag color="orange" icon={<UnlockOutlined />}>plaintext — set SESSION_ENCRYPTION_KEY</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Proxy">
                {proxyName ? (
                  <Tag color="blue">{proxyName}</Tag>
                ) : account.proxyConfig ? (
                  <Tag>inline: {account.proxyConfig.host}:{account.proxyConfig.port}</Tag>
                ) : (
                  <Text type="secondary">none (direct)</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Bound IP">
                {account.boundIp ?? <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Created">
                {dayjs(account.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col span={10}>
          <Card title="Warmup Plan" style={{ marginBottom: 16 }}>
            {!warmup ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No warmup plan yet"
              >
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleStart}>
                  Start Warmup
                </Button>
              </Empty>
            ) : (
              <>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Current phase">
                    <Tag>{PHASE_LABEL[warmup.currentPhase] ?? `P${warmup.currentPhase}`}</Tag>
                    {warmup.completed && <Tag color="success">completed</Tag>}
                    {warmup.paused && <Tag color="warning">paused</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Started">
                    {warmup.phaseStartedAt?.['0']
                      ? dayjs(warmup.phaseStartedAt['0']).format('YYYY-MM-DD HH:mm')
                      : '—'}
                  </Descriptions.Item>
                </Descriptions>

                {!warmup.completed && (
                  <Space style={{ marginTop: 12 }}>
                    {!warmup.paused && warmup.currentPhase < 4 && (
                      <Button size="small" icon={<StepForwardOutlined />} onClick={handleAdvance}>
                        Advance
                      </Button>
                    )}
                    {warmup.paused ? (
                      <Button size="small" type="primary" icon={<RedoOutlined />} onClick={handleResume}>
                        Resume
                      </Button>
                    ) : (
                      <Button size="small" icon={<PauseCircleOutlined />} onClick={handlePause}>
                        Pause
                      </Button>
                    )}
                  </Space>
                )}

                <div style={{ marginTop: 16, maxHeight: 300, overflowY: 'auto' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Actions log</Text>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={(warmup.actionsLog ?? []).slice().reverse().slice(0, 20).map((a) => ({
                      color: a.action.startsWith('paused') ? 'orange'
                        : a.action.startsWith('resumed') ? 'green'
                        : 'blue',
                      children: (
                        <div style={{ fontSize: 11 }}>
                          <Text strong>P{a.phase}</Text> {a.action}{' '}
                          <Text type="secondary">{dayjs(a.ts).format('MM-DD HH:mm:ss')}</Text>
                        </div>
                      ),
                    }))}
                  />
                </div>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="Edit role"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleEditRole}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Hybrid is currently a no-op — agent will not auto-handle messages for hybrid accounts."
        />
        <Form form={editForm} layout="vertical">
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'cs',     label: 'CS — Customer Service' },
                { value: 'ad',     label: 'AD — Advertiser' },
                { value: 'hybrid', label: 'Hybrid (no-op)' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Report health score"
        open={healthOpen}
        onCancel={() => setHealthOpen(false)}
        onOk={handleReportHealth}
        destroyOnHidden
      >
        <Form form={healthForm} layout="vertical">
          <Form.Item
            name="healthScore"
            label="Health Score (0-100)"
            rules={[{ required: true }, { type: 'number', min: 0, max: 100 }]}
            extra="80+ healthy · 60+ warning · 30+ caution · <30 critical (auto-marked error)"
          >
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="Remark (optional)">
            <Tooltip title="Free-form note for audit purposes">
              <textarea
                style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid #d9d9d9', borderRadius: 4 }}
              />
            </Tooltip>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
