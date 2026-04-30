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

const { Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onChange?: () => void;
}

export default function GroupSettingsModal({ open, onClose, onChange }: Props) {
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
        const t = await tenantsApi.getDefault();
        const tid = t.data?.id;
        setTenantId(tid);
        const s = await tenantsApi.getSettings(tid);
        const cnt = s.data?.groupCount ?? 0;
        setCurrentCount(cnt);
        setSelectedCount(cnt > 0 ? cnt : 2);
      } catch (err: any) {
        antdMessage.error(err?.response?.data?.message ?? '加载设置失败');
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
      const r1 = await executionGroupsApi.reconcile(selectedCount);
      // Step 2: persist count to tenant settings
      await tenantsApi.updateSettings(tenantId, { groupCount: selectedCount });
      // Step 3: auto-schedule baseline tasks
      const r2 = await executionGroupsApi.autoSchedule();

      const created = r1.data?.created ?? 0;
      const removed = r1.data?.removed ?? 0;
      const scheduled = r2.data?.scheduled ?? 0;

      antdMessage.success(
        `已配置 ${selectedCount} 组（新建 ${created} / 移除 ${removed}），生成 ${scheduled} 条排期任务`,
      );
      onChange?.();
      onClose();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const cycleHours = selectedCount > 0 ? (24 / selectedCount).toFixed(1) : '—';

  return (
    <Modal
      title={<Space><SettingOutlined />分组设置</Space>}
      open={open}
      onCancel={onClose}
      onOk={handleConfirm}
      okText={selectedCount === currentCount ? '关闭' : '确认并自动排期'}
      cancelText="取消"
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
            message="选择执行组别数量后，系统会自动错开所有组的任务时间，避免账号扎堆触发风控"
          />

          <div>
            <Text strong>组别数量（2 - 9）：</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 12px' }}>
              当前已配置：<Text code>{currentCount === 0 ? '未启用' : `${currentCount} 组`}</Text>
            </Paragraph>
            <Radio.Group
              value={selectedCount}
              onChange={(e) => setSelectedCount(e.target.value)}
              style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <Radio.Button key={n} value={n} style={{ flex: '1 0 auto', textAlign: 'center', minWidth: 56 }}>
                  {n} 组
                </Radio.Button>
              ))}
            </Radio.Group>
          </div>

          <Space size={32}>
            <Statistic
              title="每组容量"
              value={6}
              suffix="账号"
              prefix={<ClockCircleOutlined />}
            />
            <Statistic
              title="组间任务间隔"
              value={cycleHours}
              suffix="小时"
            />
            <Statistic
              title="可容纳总账号数"
              value={selectedCount * 6}
            />
          </Space>

          {selectedCount < currentCount && currentCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`减少到 ${selectedCount} 组：高于 ${selectedCount} 的组别会被删除，其成员会变为「未分组」，但任务历史不删`}
            />
          )}

          {selectedCount > 0 && (
            <Alert
              type="success"
              showIcon
              message="确认后系统会立即重排所有组的 keepalive 基线任务，等距错开 24 小时周期"
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
