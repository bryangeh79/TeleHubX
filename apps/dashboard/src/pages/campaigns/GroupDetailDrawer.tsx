import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Col, Descriptions, Drawer, Input, Modal, Popconfirm,
  Row, Space, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  ArrowLeftOutlined, ClearOutlined, CopyOutlined,
  DownloadOutlined, PlusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { customerGroupsApi } from '../../services/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface GroupDetail {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  sourceType: string;
  members: string[];
  memberDetails?: Array<{
    value: string;
    source: string;
    addedAt: string;
    huntTaskId?: string;
    tgUsername?: string;
    isPremium?: boolean;
  }>;
  memberCount: number;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Props {
  groupId: string | null;
  tenantId: string;
  onClose: () => void;
  onChange?: () => void;
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  manual:       { label: '粘贴',     color: 'default' },
  excel:        { label: '导入',     color: 'cyan' },
  lead_hunt:    { label: 'AI引流',   color: 'purple' },
  group_scrape: { label: '群爬取',   color: 'magenta' },
  contacts:     { label: '联系人',   color: 'blue' },
  pool_filter:  { label: '候选池',   color: 'gold' },
};

export default function GroupDetailDrawer({ groupId, tenantId, onClose, onChange }: Props) {
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendText, setAppendText] = useState('');
  const [appending, setAppending] = useState(false);

  const open = !!groupId;

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const res = await customerGroupsApi.get(groupId);
      setGroup(res.data);
    } catch {
      setGroup(null);
    } finally { setLoading(false); }
  }, [groupId]);

  useEffect(() => { if (groupId) void load(); }, [groupId, load]);

  const handleRemoveMember = async (value: string) => {
    if (!groupId) return;
    try {
      await customerGroupsApi.removeMember(groupId, value);
      antdMessage.success('已移除');
      void load();
      onChange?.();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '移除失败');
    }
  };

  const handleClearAll = async () => {
    if (!groupId) return;
    try {
      await customerGroupsApi.update(groupId, { members: [] });
      antdMessage.success('已清空');
      void load();
      onChange?.();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '清空失败');
    }
  };

  const handleExport = () => {
    if (!group) return;
    const lines = (group.memberDetails ?? group.members.map(v => ({ value: v, source: 'manual' }))).map((d: any) =>
      `${d.value}\t${SOURCE_LABELS[d.source]?.label ?? d.source}`,
    );
    const csv = '号码\t来源\n' + lines.join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${group.name}-成员-${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAppend = async () => {
    if (!groupId) return;
    const items = appendText.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean)
      .map(value => ({ value, source: 'manual' as const }));
    if (!items.length) { antdMessage.warning('没有有效号码'); return; }
    setAppending(true);
    try {
      const res = await customerGroupsApi.appendMembers(groupId, items);
      antdMessage.success(`✓ 追加 ${res.data.added} 人${res.data.skipped ? `，跳过 ${res.data.skipped} 重复` : ''}`);
      setAppendText('');
      setAppendOpen(false);
      void load();
      onChange?.();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '追加失败');
    } finally { setAppending(false); }
  };

  // 构造表格行
  const rows = (group?.memberDetails && group.memberDetails.length > 0)
    ? group.memberDetails
    : (group?.members ?? []).map(v => ({ value: v, source: 'manual', addedAt: '' }));

  const filteredRows = rows.filter(r =>
    !search || r.value.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      title: '号码 / 标识',
      dataIndex: 'value',
      render: (v: string, r: any) => (
        <Space size={4}>
          <Text style={{ fontSize: 12 }}>{v}</Text>
          {r.isPremium && <Tag color="gold" style={{ fontSize: 10 }}>Premium</Tag>}
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 90,
      render: (s: string) => {
        const cfg = SOURCE_LABELS[s] ?? { label: s, color: 'default' };
        return <Tag color={cfg.color} style={{ fontSize: 11 }}>{cfg.label}</Tag>;
      },
    },
    {
      title: '加入时间',
      dataIndex: 'addedAt',
      width: 130,
      render: (v: string) => v ? dayjs(v).format('M/D HH:mm') : '—',
    },
    {
      title: '操作',
      width: 70,
      render: (_: any, r: any) => (
        <Popconfirm title="确认从群移除？" onConfirm={() => handleRemoveMember(r.value)}
          okText="移除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button size="small" type="link" danger>移除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <Space>
            <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={onClose}>返回列表</Button>
            <span>客户群 · {group?.name ?? '...'}</span>
          </Space>
        }
        width={780}
        bodyStyle={{ padding: 16 }}
      >
        {loading || !group ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中…</div>
        ) : (
          <>
            {/* 基本信息 */}
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}
              labelStyle={{ width: 100, background: '#fafafa' }}>
              <Descriptions.Item label="名称">{group.name}</Descriptions.Item>
              <Descriptions.Item label="描述">{group.description || '—'}</Descriptions.Item>
              <Descriptions.Item label="成员数">
                <Tag color="purple">{group.memberCount} 人</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{dayjs(group.createdAt).format('YYYY/M/D HH:mm:ss')}</Descriptions.Item>
              <Descriptions.Item label="引用情况">
                被 <Text strong>{group.usedCount}</Text> 个广告引用
                {group.lastUsedAt && <Text type="secondary" style={{ marginLeft: 8 }}>· 最近使用 {dayjs(group.lastUsedAt).fromNow?.() ?? dayjs(group.lastUsedAt).format('M/D')}</Text>}
              </Descriptions.Item>
            </Descriptions>

            {/* 操作按钮组 */}
            <Space wrap style={{ marginBottom: 12 }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAppendOpen(true)}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                追加号码
              </Button>
              <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 CSV</Button>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
              <Popconfirm title="确认清空所有成员？" description="此操作不可撤销"
                onConfirm={handleClearAll} okText="清空" cancelText="取消" okButtonProps={{ danger: true }}>
                <Button icon={<ClearOutlined />} danger>清空成员</Button>
              </Popconfirm>
            </Space>

            {/* 搜索 */}
            <Input
              placeholder="搜索成员"
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              style={{ marginBottom: 8 }}
            />

            {/* 成员表 */}
            <Table
              dataSource={filteredRows}
              columns={columns}
              rowKey={(r: any) => r.value}
              size="small"
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
            />
          </>
        )}
      </Drawer>

      {/* 追加号码 Modal */}
      <Modal
        open={appendOpen}
        title="追加号码到当前群"
        onCancel={() => setAppendOpen(false)}
        onOk={handleAppend}
        confirmLoading={appending}
        okText="追加" cancelText="取消"
        okButtonProps={{ style: { background: '#52c41a', borderColor: '#52c41a' } }}
      >
        <Text type="secondary" style={{ fontSize: 11 }}>
          一行一个 · 自动去重 · 已存在的会跳过
        </Text>
        <TextArea
          rows={6}
          value={appendText}
          onChange={e => setAppendText(e.target.value)}
          placeholder={'60123456789\n@username\n+60111222333'}
          style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </>
  );
}
