import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Modal,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { executionGroupsApi } from '../../../services/api';

const { Text, Paragraph } = Typography;

const MAX_MEMBERS = 6;

const SF_PRO_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

const ROLE_COLOR: Record<string, string> = { cs: 'blue', ad: 'green', hybrid: 'orange' };

interface AccountSummary {
  id: string;
  phoneNumber: string;
  role: string;
  status: string;
  executionGroupId: string | null;
}

interface Group {
  id: string;
  slotNum: number;
  name: string | null;
  notes: string | null;
  members: AccountSummary[];
}

interface GroupsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Triggers parent reload when membership changes. */
  onChange?: () => void;
}

export default function GroupsDrawer({ open, onClose, onChange }: GroupsDrawerProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [ungrouped, setUngrouped] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerGroup, setPickerGroup] = useState<Group | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [gRes, uRes] = await Promise.all([
        executionGroupsApi.list(),
        executionGroupsApi.listUngrouped(),
      ]);
      setGroups(Array.isArray(gRes.data) ? gRes.data : []);
      setUngrouped(Array.isArray(uRes.data) ? uRes.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载组别失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const handleRemove = async (groupId: string, accountId: string) => {
    try {
      await executionGroupsApi.assignAccount(accountId, null);
      void reload();
      onChange?.();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '移除失败');
    }
  };

  const handleAdd = async (accountId: string) => {
    if (!pickerGroup) return;
    try {
      await executionGroupsApi.assignAccount(accountId, pickerGroup.id);
      antdMessage.success('已加入组');
      setPickerGroup(null);
      void reload();
      onChange?.();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '添加失败');
    }
  };

  return (
    <>
      <Drawer
        title={<Space><TeamOutlined />执行组别 · 成员管理</Space>}
        placement="right"
        width={Math.min(900, window.innerWidth - 80)}
        open={open}
        onClose={onClose}
        loading={loading}
      >
        {groups.length === 0 ? (
          <Empty
            description={
              <div>
                <Paragraph>尚未启用执行组别。</Paragraph>
                <Paragraph type="secondary" style={{ fontSize: 12 }}>
                  请先点击「分组设置」选择组别数量（2–9 组），系统会自动建立组别并排期。
                </Paragraph>
              </div>
            }
          />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`共 ${groups.length} 组，每组最多 ${MAX_MEMBERS} 个账号`}
              description="点击 + 把未分组账号加入组别；点 × 把账号移出。任何变更立即生效，不会删除任务历史。"
            />

            <Row gutter={[12, 12]}>
              {groups.map((g) => (
                <Col key={g.id} xs={24} sm={12} lg={8}>
                  <Card
                    size="small"
                    title={
                      <Space>
                        <Tag color="blue" style={{ marginRight: 0 }}>组 {g.slotNum}</Tag>
                        <Text strong>{g.name ?? `Group ${g.slotNum}`}</Text>
                      </Space>
                    }
                    extra={
                      <Tooltip title={g.members.length >= MAX_MEMBERS ? '组已满' : '添加成员'}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<UserAddOutlined />}
                          disabled={g.members.length >= MAX_MEMBERS}
                          onClick={() => setPickerGroup(g)}
                        >
                          {g.members.length}/{MAX_MEMBERS}
                        </Button>
                      </Tooltip>
                    }
                  >
                    {g.members.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<Text type="secondary" style={{ fontSize: 12 }}>暂无成员</Text>}
                      />
                    ) : (
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {g.members.map((m) => (
                          <Row key={m.id} align="middle" justify="space-between" wrap={false}>
                            <Col flex={1}>
                              <Space size={6}>
                                <Avatar size={20} style={{ backgroundColor: '#229ED9' }}>
                                  {m.phoneNumber.slice(-2)}
                                </Avatar>
                                <Text style={{ fontFamily: SF_PRO_FONT, fontSize: 13 }}>
                                  {m.phoneNumber}
                                </Text>
                                <Tag color={ROLE_COLOR[m.role]} style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                                  {m.role.toUpperCase()}
                                </Tag>
                              </Space>
                            </Col>
                            <Col>
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleRemove(g.id, m.id)}
                              />
                            </Col>
                          </Row>
                        ))}
                      </Space>
                    )}
                  </Card>
                </Col>
              ))}
            </Row>

            {ungrouped.length > 0 && (
              <Card
                size="small"
                title={<Space>未分组账号 <Tag>{ungrouped.length}</Tag></Space>}
                style={{ marginTop: 16, background: '#fafafa' }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {ungrouped.map((m) => (
                    <Row key={m.id} align="middle" justify="space-between" wrap={false}>
                      <Col flex={1}>
                        <Space size={6}>
                          <Avatar size={20} style={{ backgroundColor: '#bfbfbf' }}>
                            {m.phoneNumber.slice(-2)}
                          </Avatar>
                          <Text style={{ fontFamily: SF_PRO_FONT, fontSize: 13 }}>{m.phoneNumber}</Text>
                          <Tag color={ROLE_COLOR[m.role]} style={{ fontSize: 10 }}>
                            {m.role.toUpperCase()}
                          </Tag>
                        </Space>
                      </Col>
                    </Row>
                  ))}
                </Space>
              </Card>
            )}
          </>
        )}
      </Drawer>

      {/* 选号 Modal — 给某个组添加成员 */}
      <Modal
        title={pickerGroup ? `加入到组 ${pickerGroup.slotNum} (${pickerGroup.members.length}/${MAX_MEMBERS})` : ''}
        open={!!pickerGroup}
        onCancel={() => setPickerGroup(null)}
        footer={null}
      >
        {ungrouped.length === 0 ? (
          <Empty description="所有账号都已分组" />
        ) : (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {ungrouped.map((m) => (
              <Card
                key={m.id}
                size="small"
                hoverable
                onClick={() => handleAdd(m.id)}
                styles={{ body: { padding: '10px 12px' } }}
              >
                <Row align="middle" justify="space-between">
                  <Col>
                    <Space size={8}>
                      <Avatar style={{ backgroundColor: '#229ED9' }}>
                        {m.phoneNumber.slice(-2)}
                      </Avatar>
                      <Text strong style={{ fontFamily: SF_PRO_FONT }}>{m.phoneNumber}</Text>
                      <Tag color={ROLE_COLOR[m.role]}>{m.role.toUpperCase()}</Tag>
                    </Space>
                  </Col>
                  <Col><PlusOutlined style={{ color: '#1677ff' }} /></Col>
                </Row>
              </Card>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
}
