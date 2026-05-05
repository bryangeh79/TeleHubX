import { useCallback, useEffect, useState } from 'react';
import {
  Avatar, Button, Card, Col, Drawer, Empty, Input, Popconfirm, Row,
  Space, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { customerGroupsApi, tenantsApi } from '../../services/api';
import { useT } from '../../i18n';
import CreateGroupModal from './CreateGroupModal';
import GroupDetailDrawer from './GroupDetailDrawer';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text } = Typography;

interface CustomerGroup {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  sourceType: 'manual' | 'candidates';
  members: string[];
  memberCount: number;
  usedCount: number;
  lastUsedAt: string | null;
  tags?: string[];
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
}

export default function CustomerGroupDrawer({ open, onClose, tenantId: tenantIdProp }: Props) {
  const t = useT();
  const [tenantId, setTenantId] = useState<string>(tenantIdProp ?? '');
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // 兜底加载 tenantId
  useEffect(() => {
    if (tenantIdProp) { setTenantId(tenantIdProp); return; }
    if (!open) return;
    tenantsApi.getDefault().then(r => { if (r.data?.id) setTenantId(r.data.id); }).catch(() => {});
  }, [open, tenantIdProp]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await customerGroupsApi.list(tenantId);
      setGroups(Array.isArray(res.data) ? res.data : []);
    } catch {
      setGroups([]);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { if (open && tenantId) void load(); }, [open, tenantId, load]);

  const handleDelete = async (g: CustomerGroup) => {
    try {
      await customerGroupsApi.delete(g.id);
      antdMessage.success('已删除');
      void load();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const filtered = groups.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
    || (g.description?.toLowerCase().includes(search.toLowerCase()))
  );

  const totalMembers = groups.reduce((s, g) => s + (g.memberCount ?? 0), 0);

  const SOURCE_COLORS: Record<string, string> = {
    manual: 'blue',
    candidates: 'purple',
  };
  const SOURCE_LABELS: Record<string, string> = {
    manual: '手动',
    candidates: '引流',
  };

  const renderCard = (g: CustomerGroup) => {
    const color = SOURCE_COLORS[g.sourceType] ?? 'default';
    return (
      <div
        key={g.id}
        style={{
          border: '1px solid #e8e8e8', borderRadius: 8, padding: 12,
          marginBottom: 8, background: '#fff', display: 'flex',
          alignItems: 'center', gap: 12,
        }}
      >
        <Avatar style={{ background: '#36cfc9', flexShrink: 0 }} size={40}>
          {g.name.slice(0, 1).toUpperCase()}
        </Avatar>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
            <Text strong style={{ fontSize: 14 }}>{g.name}</Text>
            <Tag color="purple" style={{ fontSize: 11 }}>{g.memberCount} 人</Tag>
            {g.usedCount > 0 && (
              <Tag color="purple" style={{ fontSize: 11 }}>{g.usedCount} 次引用</Tag>
            )}
            <Tag color={color} style={{ fontSize: 10 }}>{SOURCE_LABELS[g.sourceType]}</Tag>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {g.description || '无描述'}
              {' · 创建 '}{dayjs(g.createdAt).fromNow()}
              {g.lastUsedAt && ` · 最近投放 ${dayjs(g.lastUsedAt).fromNow()}`}
            </Text>
          </div>
        </div>

        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailId(g.id)}>
            查看成员
          </Button>
          <Popconfirm
            title={`删除「${g.name}」?`}
            description="此操作不可撤销"
            onConfirm={() => handleDelete(g)}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
    );
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('drawer.customerGroup')}</span>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} size="small" />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                {t('common.create')}
              </Button>
            </Space>
          </div>
        }
        width={780}
        bodyStyle={{ padding: '12px 16px' }}
      >
        {/* Stats cards */}
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={12}>
            <Card size="small" bodyStyle={{ padding: 12 }}>
              <Space>
                <TeamOutlined style={{ fontSize: 22, color: '#52c41a' }} />
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>客户群数量</Text>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{groups.length}</div>
                </div>
              </Space>
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" bodyStyle={{ padding: 12 }}>
              <Space>
                <UserOutlined style={{ fontSize: 22, color: '#52c41a' }} />
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>总号码数</Text>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{totalMembers}</div>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>

        {/* Search */}
        <Input
          prefix={<SearchOutlined style={{ color: '#999' }} />}
          placeholder="搜索客户群"
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ marginBottom: 12 }}
        />

        {/* List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={search ? '没有匹配的客户群' : '还没有客户群'}
            style={{ padding: 40 }}
          >
            {!search && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                新建第一个
              </Button>
            )}
          </Empty>
        ) : (
          <div>{filtered.map(renderCard)}</div>
        )}
      </Drawer>

      <CreateGroupModal
        open={createOpen}
        tenantId={tenantId}
        existingGroups={groups}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => { setCreateOpen(false); void load(); }}
      />

      <GroupDetailDrawer
        groupId={detailId}
        tenantId={tenantId}
        onClose={() => setDetailId(null)}
        onChange={() => void load()}
      />
    </>
  );
}
