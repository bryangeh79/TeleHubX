import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Tag,
  Progress,
  Space,
  Typography,
  Popconfirm,
  Badge,
  Tooltip,
  message as antdMessage,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SendOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { campaignsApi } from '../../services/api';

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
  messageVariants: Array<{ text: string; mediaUrl?: string }> | null;
  sentCount: number;
  replyCount: number;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<CampaignStatus, 'default' | 'warning' | 'processing' | 'success' | 'error'> = {
  draft:     'default',
  scheduled: 'warning',
  running:   'processing',
  paused:    'default',
  completed: 'success',
};

export default function CampaignsPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await campaignsApi.list();
      setCampaigns(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDelete = async (c: ApiCampaign) => {
    try {
      await campaignsApi.delete(c.id);
      antdMessage.success(`Deleted "${c.name}"`);
      await reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const handleSend = async (c: ApiCampaign) => {
    try {
      const res = await campaignsApi.send(c.id);
      const targets = res.data?.targets ?? 0;
      antdMessage.success(`Campaign queued — ${targets} target(s)`);
      await reload();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? 'Send failed');
    }
  };

  const columns: ColumnsType<ApiCampaign> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, r) => (
        <div>
          <Text strong>{v}</Text>
          {r.description ? (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>{r.description}</Text>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (t: CampaignType) => (
        <Tag color={t === 'broadcast' ? 'blue' : 'purple'}>{t.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: CampaignStatus) => <Badge status={STATUS_BADGE[s]} text={s} />,
    },
    {
      title: 'Targets',
      key: 'targets',
      width: 80,
      align: 'center',
      render: (_, r) => r.targets?.length ?? 0,
    },
    {
      title: 'Variants',
      key: 'variants',
      width: 80,
      align: 'center',
      render: (_, r) => r.messageVariants?.length ?? 0,
    },
    {
      title: 'Progress',
      key: 'progress',
      width: 180,
      render: (_, r) => {
        const total = r.targets?.length ?? 0;
        if (total === 0) return <Tag>No targets</Tag>;
        const pct = Math.round((r.sentCount / total) * 100);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span>{r.sentCount} sent</span>
              <span>{total} target</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.replyCount} replies
            </Text>
          </div>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => {
        const canSend = record.status === 'draft' || record.status === 'scheduled' || record.status === 'paused';
        return (
          <Space size={4}>
            {canSend && (record.targets?.length ?? 0) > 0 && (
              <Tooltip title="Queue this campaign for dispatch">
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => handleSend(record)}
                >
                  Send
                </Button>
              </Tooltip>
            )}
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/campaigns/${record.id}/edit`)}
            />
            <Popconfirm
              title={`Delete "${record.name}"?`}
              onConfirm={() => handleDelete(record)}
              okText="Delete"
              okButtonProps={{ danger: true }}
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
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/campaigns/new')}
          >
            新建广告
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
    </div>
  );
}
