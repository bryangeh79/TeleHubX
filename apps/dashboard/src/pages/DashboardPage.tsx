import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Typography, Spin } from 'antd';
import {
  UserOutlined,
  WifiOutlined,
  HeartOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { statsApi } from '../services/api';

const { Title } = Typography;

interface Overview {
  totalAccounts: number;
  onlineAccounts: number;
  avgHealthScore: number;
  activeCampaigns: number;
}

const MOCK_OVERVIEW: Overview = {
  totalAccounts: 12,
  onlineAccounts: 8,
  avgHealthScore: 74,
  activeCampaigns: 3,
};

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi.overview()
      .then((res: any) => setData(res))
      .catch(() => setData(MOCK_OVERVIEW))
      .finally(() => setLoading(false));
  }, []);

  const overview = data ?? MOCK_OVERVIEW;

  const healthColor =
    overview.avgHealthScore >= 80 ? '#52c41a'
    : overview.avgHealthScore >= 60 ? '#faad14'
    : overview.avgHealthScore >= 30 ? '#fa8c16'
    : '#f5222d';

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>Dashboard</Title>

      {loading ? (
        <Spin />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Total Accounts"
                value={overview.totalAccounts}
                prefix={<UserOutlined />}
              />
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Online Now"
                value={overview.onlineAccounts}
                prefix={<WifiOutlined style={{ color: '#52c41a' }} />}
                valueStyle={{ color: '#52c41a' }}
                suffix={`/ ${overview.totalAccounts}`}
              />
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Avg Health Score"
                value={overview.avgHealthScore}
                prefix={<HeartOutlined style={{ color: healthColor }} />}
                valueStyle={{ color: healthColor }}
                suffix="/ 100"
              />
              <Progress
                percent={overview.avgHealthScore}
                strokeColor={healthColor}
                showInfo={false}
                size="small"
                style={{ marginTop: 8 }}
              />
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card>
              <Statistic
                title="Active Campaigns"
                value={overview.activeCampaigns}
                prefix={<SendOutlined />}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card title="Health Score Legend" size="small">
            <Row gutter={16}>
              {[
                { label: '80-100', desc: 'Healthy', color: '#52c41a' },
                { label: '60-80',  desc: 'Warning — reduce frequency', color: '#faad14' },
                { label: '30-60',  desc: 'Alert — pause some operations', color: '#fa8c16' },
                { label: '< 30',   desc: 'Critical — account suspended', color: '#f5222d' },
              ].map(item => (
                <Col key={item.label} xs={12} sm={6}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12 }}>
                      <strong>{item.label}</strong> — {item.desc}
                    </span>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
