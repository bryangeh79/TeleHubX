import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Form, Input, InputNumber, Space, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  ApiOutlined, ExportOutlined, KeyOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { platformSettingsApi } from '../../services/api';

const { Paragraph, Text, Link } = Typography;

/**
 * vmfix25 (Issue #33): standalone settings page for editing Telegram API
 * credentials AFTER install. Mirrors the install-time wizard page; useful
 * if the operator skipped the wizard, wants to rotate credentials, or
 * needs to switch to a different telegram.org app.
 *
 * Saving triggers the same backend flow (write all .env candidates +
 * detached service restart). Page polls /health and refreshes on return.
 */
export default function TgApiPage() {
  const [form] = Form.useForm<{ apiId: number; apiHash: string }>();
  const [current, setCurrent] = useState<{
    configured: boolean;
    apiId: number | null;
    apiHashMasked: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await platformSettingsApi.getTgApi();
      setCurrent(res.data);
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async () => {
    let values: { apiId: number; apiHash: string };
    try {
      values = await form.validateFields();
    } catch { return; }
    setSaving(true);
    try {
      await platformSettingsApi.saveTgApi(values.apiId, values.apiHash.trim().toLowerCase());
      antdMessage.success('已保存。服务正在重启...', 3);
      form.resetFields();
      // Poll /health for ~5 minutes
      setRestarting(true);
      pollHealth();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const pollHealth = () => {
    const startedAt = Date.now();
    const TIMEOUT = 300_000;
    setSecondsLeft(Math.ceil(TIMEOUT / 1000));
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setSecondsLeft(Math.max(0, Math.ceil((TIMEOUT - elapsed) / 1000)));
    }, 1000);

    const poll = async () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > TIMEOUT) {
        window.clearInterval(tick);
        setRestarting(false);
        antdMessage.warning('服务重启时间较长。可以手动刷新页面验证。');
        return;
      }
      try {
        const res = await fetch('/api/v1/health', { cache: 'no-store' });
        if (res.ok) {
          window.clearInterval(tick);
          setTimeout(() => {
            setRestarting(false);
            antdMessage.success('服务已重启完成 ✓');
            void load();
          }, 2000);
          return;
        }
      } catch { /* expected during restart */ }
      window.setTimeout(poll, 3000);
    };
    window.setTimeout(poll, 3000);
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <ApiOutlined style={{ marginRight: 8 }} />
          Telegram API 凭据
        </Typography.Title>
        <Text type="secondary">
          TeleHubX 通过 Telegram 官方 MTProto API 控制账号。这里配置平台共享的 api_id / api_hash。
        </Text>
      </div>

      <Card loading={loading} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">当前状态：</Text>
            {current?.configured ? (
              <Tag color="success" style={{ marginLeft: 8 }}>已配置</Tag>
            ) : (
              <Tag color="warning" style={{ marginLeft: 8 }}>未配置 — 绑号会失败</Tag>
            )}
          </div>
          {current?.configured && (
            <>
              <div>
                <Text type="secondary">API ID：</Text>
                <Text code style={{ marginLeft: 8 }}>{current.apiId}</Text>
              </div>
              <div>
                <Text type="secondary">API Hash：</Text>
                <Text code style={{ marginLeft: 8 }}>{current.apiHashMasked}</Text>
              </div>
            </>
          )}
        </Space>
      </Card>

      <Card title={current?.configured ? '修改 API 凭据' : '配置 API 凭据'}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="如何获取 api_id / api_hash"
          description={
            <>
              <ol style={{ marginBottom: 8, paddingLeft: 20 }}>
                <li>访问 <Link href="https://my.telegram.org/apps" target="_blank">my.telegram.org/apps</Link>（Telegram 账号登录）</li>
                <li>点击 <Text code>API development tools</Text></li>
                <li>填表：App title=<Text code>TeleHubX</Text>, Short name=<Text code>telehubx</Text>, Platform=<Text code>Other</Text>，URL/Description 留空</li>
                <li>点 <Text code>Create application</Text></li>
                <li>复制 <Text code>App api_id</Text>（数字）和 <Text code>App api_hash</Text>（32 位 hex）</li>
              </ol>
              <Button
                type="primary"
                size="small"
                icon={<ExportOutlined />}
                onClick={() => window.open('https://my.telegram.org/apps', '_blank', 'noopener')}
              >
                打开 my.telegram.org/apps
              </Button>
            </>
          }
        />

        {restarting ? (
          <Alert
            type="info"
            showIcon
            message="服务重启中"
            description={
              <>
                凭据已写入。后台正在重启 TeleHubX 服务。<br />
                剩余约 <Tag color="processing">{secondsLeft} 秒</Tag>。重启完成后会自动刷新此页。
              </>
            }
          />
        ) : (
          <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
            <Form.Item
              name="apiId"
              label={<Space><KeyOutlined /> API ID（数字）</Space>}
              rules={[
                { required: true, message: '请填 API ID' },
                { type: 'number', min: 1, max: 999_999_999, message: 'API ID 必须是 1-9 位整数' },
              ]}
            >
              <InputNumber style={{ width: '100%' }} placeholder="例如 1234567" controls={false} />
            </Form.Item>

            <Form.Item
              name="apiHash"
              label={<Space><KeyOutlined /> API Hash（32 位 hex）</Space>}
              rules={[
                { required: true, message: '请填 API Hash' },
                { pattern: /^[0-9a-fA-F]{32}$/, message: '必须是 32 位 hex 字符串' },
              ]}
            >
              <Input.Password placeholder="例如 abc123def456abc123def456abc123de" autoComplete="off" />
            </Form.Item>

            <Alert
              type="warning"
              showIcon
              message="保存后服务会自动重启（约 3 分钟）"
              description="重启过程中，dashboard 其他页面可能短暂断开。本页会监听 /health 并在重启完成后自动刷新。"
              style={{ marginBottom: 16 }}
            />

            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button type="primary" htmlType="submit" loading={saving} icon={<ReloadOutlined />}>
                保存并重启服务
              </Button>
            </Space>
          </Form>
        )}
      </Card>
    </div>
  );
}
