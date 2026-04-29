import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Tag,
  Progress,
  Space,
  Typography,
  Popconfirm,
  message,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed';

interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  targetGroups: number;
  accountCount: number;
  sentCount: number;
  targetCount: number;
  createdAt: string;
}

const STATUS_BADGE: Record<CampaignStatus, 'default' | 'warning' | 'processing' | 'success' | 'error'> = {
  draft:     'default',
  scheduled: 'warning',
  running:   'processing',
  paused:    'default',
  completed: 'success',
};

const MOCK: Campaign[] = [
  { id: '1', name: 'April Property Leads',  status: 'running',   targetGroups: 8,  accountCount: 3, sentCount: 180, targetCount: 300, createdAt: '2026-04-20T08:00:00Z' },
  { id: '2', name: 'Insurance Warm Leads',  status: 'paused',    targetGroups: 5,  accountCount: 2, sentCount: 60,  targetCount: 200, createdAt: '2026-04-22T10:00:00Z' },
  { id: '3', name: 'May Launch — Draft',    status: 'draft',     targetGroups: 0,  accountCount: 0, sentCount: 0,   targetCount: 0,   createdAt: '2026-04-29T15:00:00Z' },
  { id: '4', name: 'Q1 Promo Recap',        status: 'completed', targetGroups: 12, accountCount: 5, sentCount: 500, targetCount: 500, createdAt: '2026-03-01T08:00:00Z' },
];

export default function CampaignsPage() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>(MOCK);

  const handleDelete = (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id));
    message.success('Campaign deleted');
  };

  const toggleStatus = (id: string) => {
    setCampaigns(prev =>
      prev.map(c => {
        if (c.id !== id) return c;
        const next: CampaignStatus = c.status === 'running' ? 'paused' : 'running';
        return { ...c, status: next };
      })
    );
  };

  const columns: ColumnsType<Campaign> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: CampaignStatus) => (
        <Badge status={STATUS_BADGE[s]} text={s} />
      ),
    },
    {
      title: 'Groups',
      dataIndex: 'targetGroups',
      key: 'targetGroups',
      width: 80,
      align: 'center',
    },
    {
      title: 'Accounts',
      dataIndex: 'accountCount',
      key: 'accountCount',
      width: 90,
      align: 'center',
    },
    {
      title: 'Progress',
      key: 'progress',
      width: 180,
      render: (_, r) => {
        if (r.targetCount === 0) return <Tag>Not started</Tag>;
        const pct = Math.round((r.sentCount / r.targetCount) * 100);
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span>{r.sentCount} sent</span>
              <span>{r.targetCount} target</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} />
          </div>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          {(record.status === 'running' || record.status === 'paused' || record.status === 'scheduled') && (
            <Button
              size="small"
              icon={record.status === 'running' ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => toggleStatus(record.id)}
            >
              {record.status === 'running' ? 'Pause' : 'Resume'}
            </Button>
          )}
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/campaigns/${record.id}/edit`)}
          />
          <Popconfirm
            title="Delete this campaign?"
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            okType="danger"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Campaigns</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/campaigns/new')}
        >
          New Campaign
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={campaigns}
        rowKey="id"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        size="middle"
      />
    </div>
  );
}
