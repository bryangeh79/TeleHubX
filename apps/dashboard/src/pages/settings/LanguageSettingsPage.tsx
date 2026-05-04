/**
 * i18n V1 — 语言设置面板 (Issue #1 Task B).
 *
 * 三个层次:
 *   1. 系统界面语言 (System UI Language) — 纯前端 localStorage, 不存 DB
 *   2. 业务内容默认语言 (Content Default Language) — 写 tenant_settings.contentDefaultLanguage
 *   3. 客户回复语言 (Customer Reply Language) — 写 tenant_settings.customerReplyLanguage
 *      本轮仅 UI + 字段, BotGateway / AI 主流程未接入, 仍按现有行为回复客户.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Select, Space, Spin, Typography, message as antdMessage } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { LANG_OPTIONS, useI18n, useT } from '../../i18n';
import { tenantsApi } from '../../services/api';

const { Text, Title, Paragraph } = Typography;

const CONTENT_LANG_OPTIONS = LANG_OPTIONS;
const CUSTOMER_REPLY_OPTIONS = (autoLabel: string) => [
  { value: 'auto', label: autoLabel },
  ...LANG_OPTIONS,
];

interface TenantSettings {
  contentDefaultLanguage?: string;
  customerReplyLanguage?: string;
}

export default function LanguageSettingsPage() {
  const t = useT();
  const { lang, setLang } = useI18n();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [contentLang, setContentLang] = useState<string>('zh');
  const [customerLang, setCustomerLang] = useState<string>('auto');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const tenant = await tenantsApi.getDefault();
        const tid = tenant?.data?.id;
        if (!tid) {
          setLoading(false);
          return;
        }
        setTenantId(tid);
        const settings = await tenantsApi.getSettings(tid);
        const s = (settings?.data ?? {}) as TenantSettings;
        if (s.contentDefaultLanguage) setContentLang(s.contentDefaultLanguage);
        if (s.customerReplyLanguage) setCustomerLang(s.customerReplyLanguage);
      } catch {
        // 静默 — 默认值保持
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!tenantId) {
      antdMessage.error('未找到当前租户');
      return;
    }
    setSaving(true);
    try {
      await tenantsApi.updateSettings(tenantId, {
        contentDefaultLanguage: contentLang,
        customerReplyLanguage: customerLang,
      });
      antdMessage.success(t('common.success'));
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Spin tip={t('common.loading')} />;
  }

  return (
    <div>
      <Title level={4}>
        <GlobalOutlined style={{ marginRight: 8 }} />
        {t('common.language')}
      </Title>
      <Paragraph type="secondary">
        系统界面语言 / 业务内容语言 / 客户回复语言三者独立配置, 互不干扰
      </Paragraph>

      <Card style={{ marginBottom: 16 }} title={t('settings.systemUiLanguage')} size="small">
        <Form layout="vertical">
          <Form.Item label={<Text type="secondary" style={{ fontSize: 12 }}>{t('settings.systemUiLanguage.desc')}</Text>}>
            <Select
              value={lang}
              onChange={(v) => setLang(v as any)}
              options={LANG_OPTIONS}
              style={{ width: 240 }}
            />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          message="此设置仅保存在本浏览器, 不影响其他用户和后端"
          style={{ fontSize: 12 }}
        />
      </Card>

      <Card style={{ marginBottom: 16 }} title={t('settings.contentDefaultLanguage')} size="small">
        <Form layout="vertical">
          <Form.Item label={<Text type="secondary" style={{ fontSize: 12 }}>{t('settings.contentDefaultLanguage.desc')}</Text>}>
            <Select
              value={contentLang}
              onChange={setContentLang}
              options={CONTENT_LANG_OPTIONS}
              style={{ width: 240 }}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginBottom: 16 }} title={t('settings.customerReplyLanguage')} size="small">
        <Form layout="vertical">
          <Form.Item label={<Text type="secondary" style={{ fontSize: 12 }}>{t('settings.customerReplyLanguage.desc')}</Text>}>
            <Select
              value={customerLang}
              onChange={setCustomerLang}
              options={CUSTOMER_REPLY_OPTIONS(t('settings.customerReplyLanguage.auto'))}
              style={{ width: 240 }}
            />
          </Form.Item>
        </Form>
        <Alert
          type="warning"
          showIcon
          message="本轮仅持久化字段, BotGateway / AI 智能客服主流程未接入此设置, 仍按现有行为回复客户. 下一轮接入"
          style={{ fontSize: 12 }}
        />
      </Card>

      <Space>
        <Button type="primary" onClick={handleSave} loading={saving}>
          {t('common.save')}
        </Button>
      </Space>
    </div>
  );
}
