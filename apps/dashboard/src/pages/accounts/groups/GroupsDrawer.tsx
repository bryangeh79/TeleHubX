import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
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
  SwapOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { executionGroupsApi } from '../../../services/api';
import { useT } from '../../../i18n';

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
  const t = useT();
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
        title={<Space><TeamOutlined />{t('drawer.groups')}</Space>}
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
                <Paragraph>{t('groups.notEnabled')}</Paragraph>
              </div>
            }
          />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('groups.summary', { count: groups.length, max: MAX_MEMBERS })}
            />

            <Row gutter={[12, 12]}>
              {groups.map((g) => {
                const isFull = g.members.length >= MAX_MEMBERS;
                return (
                  <Col key={g.id} xs={24} sm={12} lg={8}>
                    <Card
                      size="small"
                      title={
                        <Space>
                          <Tag color="blue" style={{ marginRight: 0 }}>{t('page.accounts.col.group')} {g.slotNum}</Tag>
                          <Text strong>{g.name ?? `Group ${g.slotNum}`}</Text>
                        </Space>
                      }
                      extra={
                        <Tag color={isFull ? 'orange' : g.members.length === 0 ? 'default' : 'green'}>
                          {g.members.length}/{MAX_MEMBERS}
                        </Tag>
                      }
                    >
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

                        {/* 大的虚线 + 区域，点击打开选号 Modal */}
                        {!isFull && (
                          <div
                            onClick={() => setPickerGroup(g)}
                            style={{
                              border: '1px dashed #91caff',
                              borderRadius: 6,
                              padding: '12px 8px',
                              textAlign: 'center',
                              cursor: 'pointer',
                              background: '#f0f7ff',
                              color: '#1677ff',
                              fontSize: 13,
                              transition: 'all .15s',
                              marginTop: g.members.length > 0 ? 4 : 0,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#e6f4ff'; e.currentTarget.style.borderColor = '#1677ff'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = '#f0f7ff'; e.currentTarget.style.borderColor = '#91caff'; }}
                          >
                            <PlusOutlined style={{ marginRight: 6 }} />
                            {t('groups.addMember')}
                          </div>
                        )}
                        {isFull && (
                          <div style={{ textAlign: 'center', padding: '8px 0', color: '#bfbfbf', fontSize: 12 }}>
                            {t('groups.full')}
                          </div>
                        )}
                      </Space>
                    </Card>
                  </Col>
                );
              })}
            </Row>

            {ungrouped.length > 0 && (
              <Card
                size="small"
                title={<Space>{t('groups.ungrouped')} <Tag>{ungrouped.length}</Tag></Space>}
                style={{ marginTop: 16, background: '#fafafa' }}
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {ungrouped.map((m) => {
                    const availableGroups = groups.filter((g) => g.members.length < MAX_MEMBERS);
                    return (
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
                        <Col>
                          <Dropdown
                            disabled={availableGroups.length === 0}
                            menu={{
                              items: availableGroups.map((g) => ({
                                key: g.id,
                                label: `${t('groups.joinGroup')} ${g.slotNum} (${g.members.length}/${MAX_MEMBERS})`,
                              })),
                              onClick: async ({ key }) => {
                                try {
                                  await executionGroupsApi.assignAccount(m.id, key);
                                  antdMessage.success('已加入组');
                                  void reload();
                                  onChange?.();
                                } catch (err: any) {
                                  antdMessage.error(err?.response?.data?.message ?? '添加失败');
                                }
                              },
                            }}
                          >
                            <Button size="small" type="primary" icon={<SwapOutlined />}>
                              {t('groups.joinGroup')}
                            </Button>
                          </Dropdown>
                        </Col>
                      </Row>
                    );
                  })}
                </Space>
              </Card>
            )}
          </>
        )}
      </Drawer>

      {/* 选号 Modal — 给某个组添加成员 */}
      <Modal
        title={pickerGroup ? `${t('groups.joinGroup')} ${pickerGroup.slotNum} (${pickerGroup.members.length}/${MAX_MEMBERS})` : ''}
        open={!!pickerGroup}
        onCancel={() => setPickerGroup(null)}
        footer={null}
      >
        {ungrouped.length === 0 ? (
          <Empty description={<Paragraph>{t('common.none')}</Paragraph>} />
        ) : (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
              {t('groups.joinGroup')} {pickerGroup?.slotNum}:
            </Paragraph>
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
