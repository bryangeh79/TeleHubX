import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Form, Input, InputNumber, Modal, Space, Steps, Tag, Typography, message as antdMessage,
} from 'antd';
import {
  ApiOutlined, ClockCircleOutlined, ExportOutlined, KeyOutlined, LinkOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { platformSettingsApi } from '../services/api';

const { Paragraph, Text, Link } = Typography;

type Phase = 'edit' | 'restarting' | 'ready' | 'timeout';

interface Props {
  open: boolean;
  /** Called after restart completes successfully and user clicks 继续 */
  onComplete: () => void;
  /** Called when user cancels the modal (no save) */
  onCancel: () => void;
}

const HEALTH_URL = '/api/v1/health';
const RESTART_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

/**
 * vmfix23 (Issue #31): self-service TG API ID/Hash setup.
 *
 * Triggered when bind/init returns 503 with `code: 'tg_api_not_configured'`.
 * Walks the operator through getting credentials from my.telegram.org and
 * filling them in, then writes .env + restarts the service. Once /health
 * comes back the modal auto-closes and the caller retries the bind.
 */
export default function TgApiSetupModal({ open, onComplete, onCancel }: Props) {
  const [form] = Form.useForm<{ apiId: number; apiHash: string }>();
  const [phase, setPhase] = useState<Phase>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      setPhase('edit');
      setSubmitting(false);
      setSecondsLeft(0);
      form.resetFields();
      if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null; }
      if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    }
  }, [open, form]);

  const startPolling = () => {
    const startedAt = Date.now();
    setSecondsLeft(Math.ceil(RESTART_TIMEOUT_MS / 1000));
    tickRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setSecondsLeft(Math.max(0, Math.ceil((RESTART_TIMEOUT_MS - elapsed) / 1000)));
    }, 1000);

    const poll = async () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > RESTART_TIMEOUT_MS) {
        setPhase('timeout');
        if (tickRef.current) window.clearInterval(tickRef.current);
        return;
      }
      try {
        const res = await fetch(HEALTH_URL, { cache: 'no-store' });
        if (res.ok) {
          // Service is back. Give it 2 more seconds to be fully warm.
          setTimeout(() => {
            setPhase('ready');
            if (tickRef.current) window.clearInterval(tickRef.current);
          }, 2000);
          return;
        }
      } catch { /* connection refused, expected during restart */ }
      pollRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
    };
    pollRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
  };

  const handleSubmit = async () => {
    let values: { apiId: number; apiHash: string };
    try {
      values = await form.validateFields();
    } catch { return; }
    setSubmitting(true);
    try {
      await platformSettingsApi.saveTgApi(values.apiId, values.apiHash.trim().toLowerCase());
      antdMessage.success('已保存。服务正在重启...', 3);
      setPhase('restarting');
      startPolling();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <Space>
          <ApiOutlined />
          <span>配置 Telegram API 凭据（首次使用必填）</span>
        </Space>
      }
      width={620}
      maskClosable={false}
      closable={phase === 'edit'}
      footer={null}
      onCancel={() => phase === 'edit' && onCancel()}
    >
      {phase === 'edit' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="为什么需要这一步？"
            description={
              <Paragraph style={{ marginBottom: 0 }}>
                TeleHubX 通过 Telegram 官方 <Text code>MTProto API</Text> 控制账号。
                每个 TeleHubX 安装需要一对自己的 <Text code>api_id</Text> 和 <Text code>api_hash</Text>，
                避免与其他 TeleHubX 用户共用同一个 Telegram App ID 被风控。
                <br /><br />
                <Text strong>这是一次性配置</Text>，配完之后所有 TG 账号绑定 / 任务运行都会用这一对凭据。
              </Paragraph>
            }
          />

          <Steps
            size="small"
            current={0}
            direction="vertical"
            style={{ marginBottom: 16 }}
            items={[
              {
                title: <Text strong>第 1 步：去 my.telegram.org 申请 App</Text>,
                description: (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => window.open('https://my.telegram.org/apps', '_blank', 'noopener')}
                    >
                      打开 my.telegram.org/apps
                    </Button>
                    <Paragraph style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                      操作步骤：
                      <ol style={{ marginTop: 4, paddingLeft: 20 }}>
                        <li>用任一 Telegram 账号登录（手机号 + Telegram 收到的验证码）</li>
                        <li>点击 <Text code>API development tools</Text></li>
                        <li>填表单：
                          <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                            <li>App title: <Text code>TeleHubX</Text></li>
                            <li>Short name: <Text code>telehubx</Text></li>
                            <li>URL: <Text type="secondary">（留空）</Text></li>
                            <li>Platform: <Text code>Other</Text></li>
                            <li>Description: <Text type="secondary">（留空）</Text></li>
                          </ul>
                        </li>
                        <li>点 <Text code>Create application</Text></li>
                        <li>页面会显示 <Text code>App api_id</Text>（数字）和 <Text code>App api_hash</Text>（32 位 hex 字符串）</li>
                        <li>把它们复制到下面的两个字段</li>
                      </ol>
                    </Paragraph>
                  </div>
                ),
              },
              {
                title: <Text strong>第 2 步：填进下方 → 保存</Text>,
                description: (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    保存后服务会自动重启（约 60-90 秒），重启完成后会自动关闭此弹窗，你可以继续绑号
                  </Text>
                ),
              },
            ]}
          />

          <Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
            <Form.Item
              name="apiId"
              label={<Space><KeyOutlined /> API ID（纯数字）</Space>}
              rules={[
                { required: true, message: '请填 API ID' },
                { type: 'number', min: 1, max: 999_999_999, message: 'API ID 必须是 1 到 999,999,999 的整数' },
              ]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="例如 1234567"
                controls={false}
              />
            </Form.Item>

            <Form.Item
              name="apiHash"
              label={<Space><KeyOutlined /> API Hash（32 位 hex 字符串）</Space>}
              rules={[
                { required: true, message: '请填 API Hash' },
                { pattern: /^[0-9a-fA-F]{32}$/, message: '必须是 32 位的 hex 字符串（0-9 a-f）' },
              ]}
            >
              <Input.Password
                placeholder="例如 abc123def456abc123def456abc123de"
                autoComplete="off"
              />
            </Form.Item>

            <Alert
              type="warning"
              showIcon
              icon={<KeyOutlined />}
              style={{ marginBottom: 16 }}
              message="安全提示"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 20, fontSize: 12 }}>
                  <li><Text code>api_hash</Text> 是机密凭据，本地以加密形式保存，永不显示明文</li>
                  <li>不要把它分享给陌生人 / 截图发到群里</li>
                  <li>如果泄露，去 <Link href="https://my.telegram.org/apps" target="_blank">my.telegram.org/apps</Link> 重新生成</li>
                </ul>
              }
            />

            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting} icon={<ReloadOutlined />}>
                保存并重启服务
              </Button>
            </Space>
          </Form>
        </>
      )}

      {phase === 'restarting' && (
        <div style={{ padding: '20px 0' }}>
          <Alert
            type="info"
            showIcon
            icon={<ClockCircleOutlined spin />}
            message="服务重启中"
            description={
              <>
                <Paragraph style={{ marginBottom: 8 }}>
                  TG API 凭据已写入配置文件。后台正在重启 TeleHubX 服务以让新凭据生效。
                </Paragraph>
                <Tag color="processing">剩余约 {secondsLeft} 秒</Tag>
                <Paragraph style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }} type="secondary">
                  本窗口会自动关闭，无需操作。重启过程中浏览器其他页面可能短暂断开。
                </Paragraph>
              </>
            }
          />
        </div>
      )}

      {phase === 'ready' && (
        <div style={{ padding: '20px 0' }}>
          <Alert
            type="success"
            showIcon
            message="重启完成 ✓"
            description="TG API 已生效。点击下方按钮继续绑号。"
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Button type="primary" onClick={onComplete}>
              继续绑号
            </Button>
          </div>
        </div>
      )}

      {phase === 'timeout' && (
        <div style={{ padding: '20px 0' }}>
          <Alert
            type="error"
            showIcon
            message="重启超时（2 分钟未响应）"
            description={
              <>
                服务可能没起来。请检查：
                <ul style={{ paddingLeft: 20 }}>
                  <li>桌面是否有「TeleHubX Debug」快捷方式 — 双击查看日志</li>
                  <li>手动 <Text code>sc.exe query TeleHubX</Text> 查看服务状态</li>
                  <li>查 <Text code>%ProgramData%\TeleHubX\data\logs\supervisor.log</Text></li>
                </ul>
                如果服务能起来但 dashboard 还显示这个，刷新页面试试。
              </>
            }
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Button onClick={onCancel}>关闭</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
