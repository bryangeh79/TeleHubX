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
import { useT } from '../../i18n';

const { Text } = Typography;

const ROLE_VALUES = ['super_admin', 'admin', 'operator', 'viewer'] as const;
const ROLE_COLOR: Record<string, string> = {
  super_admin: 'red', admin: 'gold', operator: 'blue', viewer: 'default',
};
function buildRoleOptions(t: (k: string) => string) {
  return [
    { value: 'super_admin', label: t('usrs.role.superAdmin'), color: 'red' },
    { value: 'admin',       label: t('usrs.role.admin'),      color: 'gold' },
    { value: 'operator',    label: t('usrs.role.operator'),   color: 'blue' },
    { value: 'viewer',      label: t('usrs.role.viewer'),     color: 'default' },
  ];
}

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
  const t = useT();
  const ROLE_OPTIONS = buildRoleOptions(t);
  const ROLE_LABEL: Record<string, string> = Object.fromEntries(
    ROLE_OPTIONS.map((o) => [o.value, o.label]),
  );
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
      antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [filterTenant, t]);

  useEffect(() => { void reload(); }, [reload]);

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
      antdMessage.success(t('usrs.createOk', { name: values.username }));
      setCreateOpen(false);
      createForm.resetFields();
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.createFail'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (id: string, username: string) => {
    try {
      const res = await adminApi.resetUserPassword(id);
      const temp: string = res.data?.tempPassword ?? '';
      Modal.success({
        title: t('usrs.resetPwdOk.title', { name: username }),
        content: (
          <div>
            <p>{t('usrs.resetPwdOk.desc')}</p>
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
              message={t('usrs.resetPwdOk.warn')}
            />
          </div>
        ),
        width: 480,
      });
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.resetPwdFail'));
    }
  };

  const handleToggleEnabled = async (row: UserRow, val: boolean) => {
    try {
      await adminApi.updateUser(row.id, { enabled: val });
      antdMessage.success(val ? t('usrs.toggleEnabledOn') : t('usrs.toggleEnabledOff'));
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.toggleFail'));
    }
  };

  const handleChangeRole = async (row: UserRow, role: string) => {
    try {
      await adminApi.updateUser(row.id, { role });
      antdMessage.success(t('usrs.changeRoleOk', { label: ROLE_LABEL[role] ?? role }));
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.changeRoleFail'));
    }
  };

  const handleChangeTenant = async (row: UserRow, tenantId: string | null) => {
    try {
      await adminApi.updateUser(row.id, { tenantId });
      antdMessage.success(t('usrs.changeTenantOk'));
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.changeTenantFail'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminApi.deleteUser(id);
      antdMessage.success(t('usrs.delOk'));
      void reload();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('usrs.delFail'));
    }
  };

  const columns = [
    {
      title: t('usrs.col.username'),
      dataIndex: 'username',
      render: (v: string, row: UserRow) => (
        <Space>
          <UserOutlined />
          <Text strong>{v}</Text>
          {row.id === mySub && <Tag color="cyan">{t('usrs.tag.currentLogin')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('usrs.col.role'),
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
      title: t('usrs.col.tenant'),
      dataIndex: 'tenantId',
      width: 180,
      render: (tid: string | null, row: UserRow) => (
        <Select
          size="small"
          value={tid ?? '__none__'}
          style={{ width: 160 }}
          onChange={(v) => handleChangeTenant(row, v === '__none__' ? null : v)}
          options={[
            { value: '__none__', label: <Text type="secondary">{t('usrs.tenant.none')}</Text> },
            ...tenants.map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
      ),
    },
    {
      title: t('usrs.col.enabled'),
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
      title: t('usrs.col.lastLogin'),
      dataIndex: 'lastLoginAt',
      width: 140,
      render: (v: string | null) =>
        v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format('MM-DD HH:mm')}</Text>
          : <Text type="secondary" style={{ fontSize: 11 }}>{t('usrs.lastLogin.never')}</Text>,
    },
    {
      title: t('usrs.col.created'),
      dataIndex: 'createdAt',
      width: 110,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(v).format('MM-DD')}</Text>,
    },
    {
      title: t('usrs.col.actions'),
      width: 180,
      render: (_: any, row: UserRow) => (
        <Space size={4}>
          <Popconfirm
            title={t('usrs.resetPwdConfirm.title')}
            description={t('usrs.resetPwdConfirm.desc')}
            okText={t('usrs.resetPwdConfirm.ok')}
            cancelText={t('common.cancel')}
            onConfirm={() => handleResetPassword(row.id, row.username)}
          >
            <Button size="small" icon={<KeyOutlined />}>{t('usrs.btn.resetPwd')}</Button>
          </Popconfirm>
          <Popconfirm
            title={t('usrs.delConfirm.title')}
            description={row.id === mySub ? t('usrs.delConfirm.descSelf') : t('usrs.delConfirm.desc', { name: row.username })}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true, disabled: row.id === mySub }}
            onConfirm={() => handleDelete(row.id)}
            disabled={row.id === mySub}
          >
            <Button size="small" danger disabled={row.id === mySub}>{t('usrs.btn.del')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={<Space><TeamOutlined /> {t('usrs.title')} ({users.length})</Space>}
      extra={
        <Space>
          <Select
            allowClear
            size="small"
            placeholder={t('usrs.filterTenant')}
            style={{ width: 180 }}
            value={filterTenant}
            onChange={(v) => setFilterTenant(v)}
            options={tenants.map((x) => ({ value: x.id, label: x.name }))}
          />
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void reload()} loading={loading}>{t('usrs.refresh')}</Button>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('usrs.btnNew')}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('usrs.intro')}
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
        title={t('usrs.modal.new')}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={handleCreate}
        okText={t('usrs.create')}
        cancelText={t('common.cancel')}
        confirmLoading={submitting}
      >
        <Form form={createForm} layout="vertical" initialValues={{ role: 'operator' }}>
          <Form.Item name="username" label={t('usrs.field.username')} rules={[{ required: true, min: 3 }]}>
            <Input placeholder={t('usrs.field.usernamePlaceholder')} autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label={t('usrs.field.password')} rules={[{ required: true, min: 6 }]}>
            <Input.Password placeholder={t('usrs.field.passwordPlaceholder')} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label={t('usrs.field.role')} rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS.map((o) => ({
              value: o.value,
              label: <Space><Tag color={o.color} style={{ marginRight: 0 }}>{o.label}</Tag></Space>,
            }))} />
          </Form.Item>
          <Form.Item
            name="tenantId"
            label={t('usrs.field.tenant')}
            extra={t('usrs.field.tenantExtra')}
          >
            <Select
              allowClear
              placeholder={t('usrs.field.tenantPlaceholder')}
              options={tenants.map((x) => ({ value: x.id, label: x.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
