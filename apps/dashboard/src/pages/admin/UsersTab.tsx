import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Form, Input, Modal, Popconfirm, Select,
  Space, Switch, Table, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  KeyOutlined, PlusOutlined, ReloadOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminApi } from '../../services/api';

const { Text } = Typography;

const ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin (平台)', color: 'red' },
  { value: 'admin',       label: 'Admin (租户管理员)', color: 'gold' },
  { value: 'operator',    label: 'Operator (运营)',   color: 'blue' },
  { value: 'viewer',      label: 'Viewer (只读)',     color: 'default' },
];

const ROLE_COLOR: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.value, o.color]),
);
const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((o) => [o.value, o.label]),
);

interface UserRow {
  id: string;
  username: string;
  role: string;
  tenantId: string | null;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface TenantRow {
  id: string;
  name: string;
}

/** 当前登录用户 sub（用于禁止删自己） */
function currentUserSub(): string | null {
  try {
    const raw = localStorage.getItem('telehubx:user');
    return raw ? JSON.parse(raw)?.sub ?? null : null;
  } catch { return null; }
}

export default function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterTenant, setFilterTenant] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const mySub = currentUserSub();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, tRes] = await Promise.all([
        adminApi.listUsers(filterTenant),
        adminApi.listTenants(),
      ]);
      setUsers(Array.isArray(uRes.data) ? uRes.data : []);
      setTenants(Array.isArray(tRes.data) ? tRes.data : []);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filterTenant]);

  useEffect(() => { void reload(); }, [reload]);

  const tenantName = (id: string | null) => {
    if (!id) return <Text type="secondary">-</Text>;
    const t = tenants.find((x) => x.id === id);
    return t?.name ?? <Text type="secondary" style={{ fontSize: 11 }}>{id.slice(0, 8)}…</Text>;
  };

  const handleCreate = async () => {
    let values: any;
    try { values = await createForm.validateFields(); } catch { return; }
    setSubmitting(true);
    try {
      await adminApi.createUser({
        username: values.username.trim(),
        password: values.password,
        role: values.role,
        tenantId: values.tenantId ?? null,
        enabled: true,
      });
      antdMessage.success(`用户 ${values.username} 已创建`);
      setCreateOpen(false);
      createForm.resetFields();
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (id: string, username: string) => {
    try {
      const res = await adminApi.resetUserPassword(id);
      const temp: string = res.data?.tempPassword ?? '';
      Modal.success({
        title: `用户 ${username} 密码已重置`,
        content: (
          <div>
            <p>临时密码（请立即告知用户并要求其登录后修改）：</p>
            <Input.Password
              value={temp}
              readOnly
              visibilityToggle={{ visible: true, onVisibleChange: () => {} }}
              style={{ fontFamily: 'monospace', fontSize: 14 }}
            />
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="此密码只显示一次，关闭后无法再次查看"
            />
          </div>
        ),
        width: 480,
      });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '重置失败');
    }
  };

  const handleToggleEnabled = async (row: UserRow, val: boolean) => {
    try {
      await adminApi.updateUser(row.id, { enabled: val });
      antdMessage.success(val ? '已启用' : '已禁用');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '操作失败');
    }
  };

  const handleChangeRole = async (row: UserRow, role: string) => {
    try {
      await adminApi.updateUser(row.id, { role });
      antdMessage.success(`已改为 ${ROLE_LABEL[role] ?? role}`);
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '改 role 失败');
    }
  };

  const handleChangeTenant = async (row: UserRow, tenantId: string | null) => {
    try {
      await adminApi.updateUser(row.id, { tenantId });
      antdMessage.success('已改租户');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '改租户失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminApi.deleteUser(id);
      antdMessage.success('已删除');
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '删除失败');
    }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      render: (v: string, row: UserRow) => (
        <Space>
          <UserOutlined />
          <Text strong>{v}</Text>
          {row.id === mySub && <Tag color="cyan">当前登录</Tag>}
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 200,
      render: (r: string, row: UserRow) => (
        <Select
          size="small"
          value={r}
          style={{ width: 180 }}
          options={ROLE_OPTIONS.map((o) => ({
            value: o.value,
            label: <Tag color={o.color} style={{ marginRight: 0 }}>{o.label}</Tag>,
          }))}
          onChange={(v) => handleChangeRole(row, v)}
          disabled={row.id === mySub}
        />
      ),
    },
    {
      title: '租户',
      dataIndex: 'tenantId',
      width: 180,
      render: (tid: string | null, row: UserRow) => (
        <Select
          size="small"
          value={tid ?? '__none__'}
          style={{ width: 160 }}
          onChange={(v) => handleChangeTenant(row, v === '__none__' ? null : v)}
          options={[
            { value: '__none__', label: <Text type="secondary">— 无 —</Text> },
            ...tenants.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean, row: UserRow) => (
        <Switch
          size="small"
          checked={v}
          disabled={row.id === mySub}
          style={{ background: v ? '#52c41a' : undefined }}
          onChange={(val) => handleToggleEnabled(row, val)}
        />
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      width: 140,
      render: (v: string | null) =>
        v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format('MM-DD HH:mm')}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>从未登录</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 110,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(v).format('MM-DD')}</Text>,
    },
    {
      title: '操作',
      width: 180,
      render: (_: any, row: UserRow) => (
        <Space size={4}>
          <Popconfirm
            title="重置密码"
            description="生成新的临时密码并显示。当前用户的旧密码立即失效。"
            okText="重置"
            cancelText="取消"
            onConfirm={() => handleResetPassword(row.id, row.username)}
          >
            <Button size="small" icon={<KeyOutlined />}>重置密码</Button>
          </Popconfirm>
          <Popconfirm
            title="删除用户"
            description={row.id === mySub ? '不能删除自己当前登录的账号' : `确认删除 ${row.username}？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, disabled: row.id === mySub }}
            onConfirm={() => handleDelete(row.id)}
            disabled={row.id === mySub}
          >
            <Button size="small" danger disabled={row.id === mySub}>删</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={<Space><TeamOutlined /> 用户管理 ({users.length})</Space>}
      extra={
        <Space>
          <Select
            allowClear
            size="small"
            placeholder="筛选租户"
            style={{ width: 180 }}
            value={filterTenant}
            onChange={(v) => setFilterTenant(v)}
            options={tenants.map((t) => ({ value: t.id, label: t.name }))}
          />
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void reload()} loading={loading}>刷新</Button>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新增用户
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="平台所有用户，包括各租户内的子账号。super_admin 不绑租户（跨租户）；其他角色必须绑到一个租户。"
      />
      <Table
        dataSource={users}
        columns={columns as any}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: false }}
        loading={loading}
      />

      <Modal
        open={createOpen}
        title="新增用户"
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={handleCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
      >
        <Form form={createForm} layout="vertical" initialValues={{ role: 'operator' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}>
            <Input placeholder="例: alice" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS.map((o) => ({
              value: o.value,
              label: <Space><Tag color={o.color} style={{ marginRight: 0 }}>{o.label}</Tag></Space>,
            }))} />
          </Form.Item>
          <Form.Item
            name="tenantId"
            label="所属租户"
            extra="super_admin 可不选；其他角色必须选一个"
          >
            <Select
              allowClear
              placeholder="— 无（跨租户 super_admin）—"
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
