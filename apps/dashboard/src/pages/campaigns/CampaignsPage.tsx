import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Tag, Progress, Space, Typography,
  Popconfirm, Badge, Dropdown, message as antdMessage,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SendOutlined,
  ReloadOutlined, TeamOutlined, FileTextOutlined, DownOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { campaignsApi, tenantsApi } from '../../services/api';
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
  pacePreset: string | null;
  scheduleMode: string | null;
  createdAt: string;
}

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
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [adDrawerOpen, setAdDrawerOpen] = useState(false);
  const [greetingDrawerOpen, setGreetingDrawerOpen] = useState(false);
  const [groupsDrawerOpen, setGroupsDrawerOpen] = useState(false);
  const [logCampaign, setLogCampaign] = useState<{ id: string; name: string } | null>(null);
  const [tenantId, setTenantId] = useState<string>('');

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

  const targetCount = (r: ApiCampaign) =>
    (r.targets?.length ?? 0) + (r.customerGroupIds?.length ? 1 : 0);

  const columns: ColumnsType<ApiCampaign> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, r) => (
        <div>
          <Text strong>{v}</Text>
          {r.description && (
            <div><Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (t: CampaignType) => (
        <Tag color={t === 'broadcast' ? 'blue' : 'purple'}>{TYPE_TEXT[t] ?? t}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: CampaignStatus) => <Badge status={STATUS_BADGE[s]} text={STATUS_TEXT[s] ?? s} />,
    },
    {
      title: '节奏',
      dataIndex: 'pacePreset',
      key: 'pacePreset',
      width: 70,
      render: (v: string | null) => {
        const map: Record<string, string> = { conservative: '保守', balanced: '平衡', aggressive: '投放' };
        return v ? <Tag>{map[v] ?? v}</Tag> : '—';
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 180,
      render: (_, r) => {
        const manualTargets = r.targets?.length ?? 0;
        const groupCount = r.customerGroupIds?.length ?? 0;
        const hasAnyTarget = manualTargets > 0 || groupCount > 0;
        if (!hasAnyTarget) return <Tag>无目标</Tag>;
        // 没有客户群成员数信息，先按手动号码算进度（有客户群时显示「群+号码」）
        const desc = groupCount > 0
          ? `${groupCount} 个群${manualTargets > 0 ? ` + ${manualTargets} 号` : ''}`
          : `${manualTargets} 号`;
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span>已发 {r.sentCount}</span><span>{desc}</span>
            </div>
            <Progress percent={r.sentCount > 0 ? Math.min(100, r.sentCount) : 0} size="small" showInfo={false} />
            <Text type="secondary" style={{ fontSize: 11 }}>{r.replyCount} 条回复</Text>
          </div>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => {
        const canSend = record.status === 'draft' || record.status === 'scheduled' || record.status === 'paused';
        const hasTargets = (record.targets?.length ?? 0) > 0 || (record.customerGroupIds?.length ?? 0) > 0;
        const isRunningOrDone = record.status === 'running' || record.status === 'completed';
        return (
          <Space size={4}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          广告投放{' '}
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>({campaigns.length})</Text>
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading} />
          <Button icon={<TeamOutlined />} onClick={() => setGroupsDrawerOpen(true)}>客户群管理</Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'ad',
                  label: '广告文案',
                  icon: <FileTextOutlined />,
                  onClick: () => setAdDrawerOpen(true),
                },
                {
                  key: 'greeting',
                  label: '开场白',
                  icon: <FileTextOutlined />,
                  onClick: () => setGreetingDrawerOpen(true),
                },
              ],
            }}
          >
            <Button icon={<FileTextOutlined />}>
              文案 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openNew}
            style={{ background: '#52c41a', borderColor: '#52c41a' }}
          >
            + 新建投放
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={campaigns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
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
