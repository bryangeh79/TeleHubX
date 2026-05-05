import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Radio,
  Space,
  Spin,
  Statistic,
  Typography,
  message as antdMessage,
} from 'antd';
import { ClockCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { executionGroupsApi, tenantsApi } from '../../../services/api';
import { useT } from '../../../i18n';

const { Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onChange?: () => void;
}

export default function GroupSettingsModal({ open, onClose, onChange }: Props) {
  const t = useT();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [selectedCount, setSelectedCount] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const tenant = await tenantsApi.getDefault();
        const tid = tenant.data?.id;
        setTenantId(tid);
        const s = await tenantsApi.getSettings(tid);
        const cnt = s.data?.groupCount ?? 0;
        setCurrentCount(cnt);
        setSelectedCount(cnt > 0 ? cnt : 2);
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? t('msg.loadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const handleConfirm = async () => {
    if (!tenantId) return;
    if (selectedCount === currentCount) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      // Step 1: reconcile groups (create/remove)
      await executionGroupsApi.reconcile(selectedCount);
      // Step 2: persist count to tenant settings
      await tenantsApi.updateSettings(tenantId, { groupCount: selectedCount });
      // Step 3: auto-schedule baseline tasks
      await executionGroupsApi.autoSchedule();

      antdMessage.success(t('groups.settings.savedSummary', { count: selectedCount }));
      onChange?.();
      onClose();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? t('msg.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const cycleHours = selectedCount > 0 ? (24 / selectedCount).toFixed(1) : '—';

  return (
    <Modal
      title={<Space><SettingOutlined />{t('common.edit')}</Space>}
      open={open}
      onCancel={onClose}
      onOk={handleConfirm}
      okText={selectedCount === currentCount ? t('common.close') : t('common.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={submitting}
      width={560}
    >
      {loading ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={t('groups.settings.intro')}
          />

          <div>
            <Text strong>{t('groups.settings.countLabel')}</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 12px' }}>
              {t('groups.settings.current')}: <Text code>{currentCount === 0 ? t('common.none') : `${currentCount}`}</Text>
            </Paragraph>
            <Radio.Group
              value={selectedCount}
              onChange={(e) => setSelectedCount(e.target.value)}
              style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <Radio.Button key={n} value={n} style={{ flex: '1 0 auto', textAlign: 'center', minWidth: 56 }}>
                  {n}
                </Radio.Button>
              ))}
            </Radio.Group>
          </div>

          <Space size={32}>
            <Statistic
              title={t('groups.settings.capacityPerGroup')}
              value={6}
              prefix={<ClockCircleOutlined />}
            />
            <Statistic
              title={t('groups.settings.cycleInterval')}
              value={cycleHours}
              suffix="h"
            />
            <Statistic
              title={t('groups.settings.totalCapacity')}
              value={selectedCount * 6}
            />
          </Space>

          {selectedCount < currentCount && currentCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={t('groups.settings.warnReduce', { n: selectedCount })}
            />
          )}

          {selectedCount > 0 && (
            <Alert
              type="success"
              showIcon
              message={t('groups.settings.confirmReschedule')}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
