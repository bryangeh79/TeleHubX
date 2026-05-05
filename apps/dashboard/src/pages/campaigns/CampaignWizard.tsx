import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Checkbox, Col, Descriptions, Divider,
  Form, Input, Modal, Progress, Radio, Row, Select, Space, Spin, Steps,
  Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import {
  CalendarOutlined, CloseOutlined, InfoCircleOutlined,
  ReloadOutlined, SafetyOutlined, ScheduleOutlined, ThunderboltOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adTemplatesApi, campaignsApi, customerGroupsApi,
  greetingTemplatesApi, slotsApi, tenantsApi,
} from '../../services/api';
import { useT } from '../../i18n';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ── Types ──────────────────────────────────────────────────────────────

type ScheduleMode = 'immediate' | 'once' | 'daily' | 'weekly';
type PacePreset = 'conservative' | 'balanced' | 'aggressive';
type GreetingMode = 'fixed' | 'random' | 'none';
type AccountSourceMode = 'auto' | 'manual';

interface WizardState {
  // Step 1
  name: string;
  scheduleMode: ScheduleMode;
  scheduledAt?: string;
  scheduleTime?: string;
  scheduleDayOfWeek?: number;
  customerGroupIds: string[];
  targets: string;           // newline-separated manual numbers

  // Step 2
  adMode: 'single' | 'rotate';
  adTemplateId?: string;
  adTemplateIds: string[];
  greetingMode: GreetingMode;
  greetingTemplateIds: string[];

  // Step 3
  accountSourceMode: AccountSourceMode;
  adAccountIds: string[];
  pacePreset: PacePreset;
}

const PACE_INFO: Record<PacePreset, { label: string; daily: number; windows: number; tag?: string }> = {
  conservative: { label: 'Conservative', daily: 20, windows: 3, tag: 'Recommended' },
  balanced:     { label: 'Balanced',     daily: 30, windows: 3 },
  aggressive:   { label: 'Aggressive',   daily: 40, windows: 2 },
};

/** Round-11: SCHEDULE_OPTIONS labels 走 t() — 渲染时再 resolve. icon/value 静态 */
const SCHEDULE_ICONS: Record<ScheduleMode, React.ReactNode> = {
  immediate: <ThunderboltOutlined />,
  once:      <CalendarOutlined />,
  daily:     <ReloadOutlined />,
  weekly:    <CalendarOutlined />,
};
const SCHEDULE_VALUES: ScheduleMode[] = ['immediate', 'once', 'daily', 'weekly'];

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// ── Summary panel ──────────────────────────────────────────────────────

function SummaryPanel({
  state, capacity, customerGroups, adTemplates, greetingTemplates,
}: {
  state: WizardState;
  capacity: any;
  customerGroups: any[];
  adTemplates: any[];
  greetingTemplates: any[];
}) {
  const t = useT();
  const safetyColor = capacity?.safetyLevel === 'safe' ? '#52c41a'
    : capacity?.safetyLevel === 'warning' ? '#faad14'
    : capacity?.safetyLevel === 'risk' ? '#ff4d4f'
    : '#d9d9d9';

  const safetyLabel = capacity?.safetyLevel === 'safe' ? t('campaign.wizard.safety.safe')
    : capacity?.safetyLevel === 'warning' ? t('campaign.wizard.safety.warning')
    : capacity?.safetyLevel === 'risk' ? t('campaign.wizard.safety.risk')
    : t('campaign.wizard.safety.config');

  const scheduleText = state.scheduleMode === 'immediate' ? t('campaign.wizard.schedule.immediate')
    : state.scheduleMode === 'once' ? `${t('campaign.wizard.schedule.once')}: ${state.scheduledAt ?? '--'}`
    : state.scheduleMode === 'daily' ? `${t('campaign.wizard.schedule.daily')} ${state.scheduleTime ?? '--'}`
    : state.scheduleDayOfWeek != null
      ? `${t('campaign.wizard.schedule.weekly')} ${DAY_LABELS[state.scheduleDayOfWeek]} ${state.scheduleTime ?? ''}`
      : t('campaign.wizard.schedule.weekly');

  const groupNames = customerGroups
    .filter(g => state.customerGroupIds.includes(g.id))
    .map(g => g.name).join(', ') || '—';

  const extraCount = state.targets.trim().split(/\n+/).filter(Boolean).length;

  const adText = state.adMode === 'single' && state.adTemplateId
    ? `1 · ${t('campaign.wizard.adMode.single')}`
    : state.adTemplateIds.length
    ? `${state.adTemplateIds.length} · ${t('campaign.wizard.adMode.rotate')}`
    : '—';

  const greetText = state.greetingMode === 'none' ? t('campaign.wizard.greetingMode.none')
    : state.greetingMode === 'fixed' ? `${t('campaign.wizard.greetingMode.fixed')} · ${state.greetingTemplateIds.length}`
    : `${t('campaign.wizard.greetingMode.random')} · ${state.greetingTemplateIds.length}`;

  return (
    <Card
      title={t('campaign.wizard.summary.title')}
      size="small"
      extra={<Badge color={safetyColor} text={<Text style={{ fontSize: 12, color: safetyColor }}>{safetyLabel}</Text>} />}
      style={{ position: 'sticky', top: 0 }}
    >
      <Descriptions column={1} size="small" labelStyle={{ color: '#999', width: 70 }}>
        <Descriptions.Item label={t('common.name')}>{state.name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('campaign.wizard.summary.time')}>{scheduleText}</Descriptions.Item>
        <Descriptions.Item label={t('campaign.wizard.summary.groups')}>{groupNames}</Descriptions.Item>
        <Descriptions.Item label={t('campaign.wizard.summary.extra')}>{extraCount > 0 ? `${extraCount}` : '—'}</Descriptions.Item>
        <Descriptions.Item label={t('campaign.wizard.summary.ad')}>{adText}</Descriptions.Item>
        <Descriptions.Item label={t('campaign.wizard.summary.greeting')}>{greetText}</Descriptions.Item>
        <Descriptions.Item label={t('wizard.step.account')}>{state.accountSourceMode === 'auto' ? t('campaign.wizard.account.auto') : `${t('campaign.wizard.account.manual')} (${state.adAccountIds.length})`}</Descriptions.Item>
        <Descriptions.Item label={t('wizard.step.pace')}>{t(`pace.${state.pacePreset}`)}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

// ── Step 1: 投放对象 ──────────────────────────────────────────────────

function Step1({
  state, onChange, customerGroups,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  customerGroups: any[];
}) {
  const t = useT();
  const hasTarget = state.customerGroupIds.length > 0 || state.targets.trim().length > 0;
  return (
    <div>
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>Aa</span>{t('wizard.step.name')}</>} style={{ marginBottom: 12 }}>
        <Input
          value={state.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={t('form.placeholder.required')}
          maxLength={50}
          showCount
        />
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>⏱</span>{t('wizard.step.schedule')}</>} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCHEDULE_VALUES.map(value => (
            <div
              key={value}
              onClick={() => onChange({ scheduleMode: value })}
              style={{
                flex: 1, minWidth: 100, border: `1px solid ${state.scheduleMode === value ? '#52c41a' : '#d9d9d9'}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'center',
                background: state.scheduleMode === value ? '#f6ffed' : '#fff',
                color: state.scheduleMode === value ? '#52c41a' : '#333',
              }}
            >
              <div style={{ fontSize: 18 }}>{SCHEDULE_ICONS[value]}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{t(`campaign.wizard.schedule.${value}`)}</div>
              {state.scheduleMode === value && (
                <div style={{ fontSize: 18, color: '#52c41a' }}>✓</div>
              )}
            </div>
          ))}
        </div>
        {state.scheduleMode === 'once' && (
          <Input
            type="datetime-local"
            style={{ marginTop: 12 }}
            value={state.scheduledAt}
            onChange={e => onChange({ scheduledAt: e.target.value })}
          />
        )}
        {(state.scheduleMode === 'daily' || state.scheduleMode === 'weekly') && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {state.scheduleMode === 'weekly' && (
              <Select
                style={{ width: 100 }}
                value={state.scheduleDayOfWeek}
                onChange={v => onChange({ scheduleDayOfWeek: v })}
                options={DAY_LABELS.map((d, i) => ({ value: i, label: d }))}
                placeholder={t('wizard.schedule.dayOfWeek')}
              />
            )}
            <Input
              type="time"
              style={{ width: 120 }}
              value={state.scheduleTime}
              onChange={e => onChange({ scheduleTime: e.target.value })}
              placeholder={t('wizard.schedule.time')}
            />
          </div>
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>👥</span>{t('wizard.step.targets')}</>} style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 13 }}>{t('wizard.targets.selectGroup')}</Text>
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 4 }}
            placeholder={t('createGroup.selectExisting')}
            value={state.customerGroupIds}
            onChange={v => onChange({ customerGroupIds: v })}
            options={customerGroups.map(g => ({
              value: g.id,
              label: `${g.name} · ${g.memberCount} 人`,
            }))}
            notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>还没有客户群，在下面手动填号码</Text>}
          />
        </div>
        <div>
          <Text style={{ fontSize: 13 }}>{t('wizard.targets.extraNumbers')}</Text>
          <TextArea
            style={{ marginTop: 4 }}
            rows={4}
            placeholder="+60123456789&#10;@username&#10;-1001234567890"
            value={state.targets}
            onChange={e => onChange({ targets: e.target.value })}
            maxLength={2000}
            showCount
          />
        </div>
        {!hasTarget && (
          <Alert
            type="warning"
            showIcon
            message={t('wizard.targets.required')}
            style={{ marginTop: 8 }}
          />
        )}
        <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
          {t('wizard.targets.distributeNote')}
        </Text>
      </Card>
    </div>
  );
}

// ── Step 2: 广告内容 ──────────────────────────────────────────────────

function Step2({
  state, onChange, adTemplates, greetingTemplates,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  adTemplates: any[];
  greetingTemplates: any[];
}) {
  const t = useT();
  const selectedAds = state.adMode === 'single'
    ? (state.adTemplateId ? [state.adTemplateId] : [])
    : state.adTemplateIds;

  const toggleAd = (id: string) => {
    if (state.adMode === 'single') {
      onChange({ adTemplateId: state.adTemplateId === id ? undefined : id });
    } else {
      onChange({
        adTemplateIds: state.adTemplateIds.includes(id)
          ? state.adTemplateIds.filter(x => x !== id)
          : [...state.adTemplateIds, id],
      });
    }
  };

  const toggleGreeting = (id: string) => {
    onChange({
      greetingTemplateIds: state.greetingTemplateIds.includes(id)
        ? state.greetingTemplateIds.filter(x => x !== id)
        : [...state.greetingTemplateIds, id],
    });
  };

  const noAd = selectedAds.length === 0;

  return (
    <div>
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>📣</span>{t('wizard.step.adContent')}</>} style={{ marginBottom: 12 }}>
        <Radio.Group
          value={state.adMode}
          onChange={e => onChange({ adMode: e.target.value, adTemplateId: undefined, adTemplateIds: [] })}
          style={{ marginBottom: 12 }}
        >
          <Radio value="single">{t('campaign.wizard.adMode.single')}</Radio>
          <Radio value="rotate">{t('campaign.wizard.adMode.rotate')}</Radio>
        </Radio.Group>

        {adTemplates.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={t('wizard.ad.noTemplates')}
          />
        ) : (
          <Row gutter={[8, 8]}>
            {adTemplates.map(tpl => {
              const selected = selectedAds.includes(tpl.id);
              return (
                <Col span={12} key={tpl.id}>
                  <div
                    onClick={() => toggleAd(tpl.id)}
                    style={{
                      border: `1px solid ${selected ? '#52c41a' : '#d9d9d9'}`,
                      borderRadius: 8, padding: 12, cursor: 'pointer',
                      background: selected ? '#f6ffed' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Checkbox checked={selected} onChange={() => toggleAd(tpl.id)} />
                      {tpl.hasMedia && <Tag color="green" style={{ fontSize: 11 }}>{t('adTemplate.hasMedia')}</Tag>}
                    </div>
                    <Text strong style={{ fontSize: 13 }}>{tpl.name}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {tpl.content.slice(0, 60)}{tpl.content.length > 60 ? '…' : ''}
                      </Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t('adTemplate.lastModified')}: {dayjs(tpl.updatedAt).format('YYYY/M/D')}
                    </Text>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}

        {noAd && adTemplates.length > 0 && (
          <Alert type="warning" showIcon message={t('campaign.wizard.alert.adRequired')} style={{ marginTop: 8 }} />
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>💬</span>{t('wizard.step.greeting')}</>}>
        <Text style={{ fontSize: 13, fontWeight: 500 }}>{t('wizard.greeting.step1')}</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 16 }}>
          {([
            { value: 'fixed' as const,  label: t('wizard.greeting.fixed.label'),  sub: t('wizard.greeting.fixed.sub'),  tag: '' },
            { value: 'random' as const, label: t('wizard.greeting.random.label'), sub: t('wizard.greeting.random.sub'), tag: t('cs.replyMode.recommended') },
            { value: 'none' as const,   label: t('wizard.greeting.none.label'),   sub: t('wizard.greeting.none.sub'),   tag: '' },
          ]).map(opt => (
            <div
              key={opt.value}
              onClick={() => onChange({ greetingMode: opt.value })}
              style={{
                flex: 1, border: `1px solid ${state.greetingMode === opt.value ? '#52c41a' : '#d9d9d9'}`,
                borderRadius: 8, padding: 12, cursor: 'pointer',
                background: state.greetingMode === opt.value ? '#f6ffed' : '#fff',
                position: 'relative',
              }}
            >
              <Radio checked={state.greetingMode === opt.value} style={{ marginBottom: 4 }} />
              {opt.tag && <Tag color="green" style={{ fontSize: 10, position: 'absolute', top: 8, right: 8 }}>{opt.tag}</Tag>}
              <div style={{ fontWeight: 500, fontSize: 13 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: '#999' }}>{opt.sub}</div>
            </div>
          ))}
        </div>

        {state.greetingMode !== 'none' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: 500 }}>{t('wizard.greeting.step2')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {state.greetingTemplateIds.length}/{state.greetingMode === 'fixed' ? '1' : '∞'}
                {state.greetingMode === 'random' && ` (${t('wizard.greeting.atLeast2')})`}
              </Text>
            </div>
            {greetingTemplates.length === 0 ? (
              <Alert type="info" showIcon message={t('campaign.wizard.alert.noGreeting')} />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {greetingTemplates.map(g => {
                  const selected = state.greetingTemplateIds.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      onClick={() => {
                        if (state.greetingMode === 'fixed') {
                          onChange({ greetingTemplateIds: selected ? [] : [g.id] });
                        } else {
                          toggleGreeting(g.id);
                        }
                      }}
                      style={{
                        border: `1px solid ${selected ? '#52c41a' : '#d9d9d9'}`,
                        borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                        background: selected ? '#f6ffed' : '#fff', minWidth: 140,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Checkbox checked={selected} onChange={() => {}} />
                        {g.aiScore && (
                          <Tag color="blue" style={{ fontSize: 10 }}>AI · {g.aiScore}</Tag>
                        )}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>{g.text}</div>
                      {g.category && <Text type="secondary" style={{ fontSize: 11 }}>{g.category}</Text>}
                    </div>
                  );
                })}
              </div>
            )}
            {state.greetingMode === 'random' && state.greetingTemplateIds.length > 0 && state.greetingTemplateIds.length < 2 && (
              <Alert
                type="info"
                showIcon
                message={t('wizard.greeting.atLeast2')}
                style={{ marginTop: 8 }}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ── Step 3: 执行方式 ──────────────────────────────────────────────────

function Step3({
  state, onChange, adAccounts, capacity, capacityLoading,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  adAccounts: any[];
  capacity: any;
  capacityLoading: boolean;
}) {
  const t = useT();
  const safeColor = capacity?.safetyLevel === 'safe' ? '#52c41a'
    : capacity?.safetyLevel === 'warning' ? '#faad14' : '#ff4d4f';
  const capacityPct = capacity
    ? Math.min(100, Math.round((capacity.capacity / Math.max(capacity.targetCount, 1)) * 100))
    : 0;

  return (
    <div>
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>👤</span>{t('wizard.step.account')}</>} style={{ marginBottom: 12 }}>
        {([
          {
            value: 'auto' as const,
            label: t('wizard.account.auto.label'),
            sub: t('wizard.account.auto.sub'),
            tag: t('cs.replyMode.recommended'),
          },
          {
            value: 'manual' as const,
            label: t('wizard.account.manual.label'),
            sub: t('wizard.account.manual.sub'),
          },
        ]).map(opt => (
          <div
            key={opt.value}
            onClick={() => onChange({ accountSourceMode: opt.value })}
            style={{
              border: `1px solid ${state.accountSourceMode === opt.value ? '#52c41a' : '#d9d9d9'}`,
              borderRadius: 8, padding: 12, cursor: 'pointer', marginBottom: 8,
              background: state.accountSourceMode === opt.value ? '#f6ffed' : '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio checked={state.accountSourceMode === opt.value} onChange={() => {}} />
              <span style={{ fontWeight: 500 }}>{opt.label}</span>
              {opt.tag && <Tag color="green" style={{ fontSize: 11 }}>{opt.tag}</Tag>}
            </div>
            <div style={{ fontSize: 12, color: '#999', marginLeft: 22 }}>{opt.sub}</div>
          </div>
        ))}
        {state.accountSourceMode === 'manual' && (
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 8 }}
            placeholder={t('wizard.account.selectAccount')}
            value={state.adAccountIds}
            onChange={v => onChange({ adAccountIds: v })}
            options={adAccounts.map((a: any) => ({
              value: a.id,
              label: `${a.phoneNumber} (${a.role})`,
            }))}
          />
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>⚡</span>{t('wizard.step.pace')}</>} style={{ marginBottom: 12 }}>
        {(Object.entries(PACE_INFO) as [PacePreset, typeof PACE_INFO[PacePreset]][]).map(([value, info]) => (
          <div
            key={value}
            onClick={() => onChange({ pacePreset: value })}
            style={{
              border: `1px solid ${state.pacePreset === value ? '#52c41a' : '#d9d9d9'}`,
              borderRadius: 8, padding: '10px 14px', cursor: 'pointer', marginBottom: 8,
              background: state.pacePreset === value ? '#f6ffed' : '#fff',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio checked={state.pacePreset === value} onChange={() => {}} />
              <span style={{ fontWeight: 500 }}>{t(`pace.${value}`)}</span>
              {info.tag && <Tag color="green" style={{ fontSize: 11 }}>{t('cs.replyMode.recommended')}</Tag>}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('wizard.pace.hint', { daily: info.daily, windows: info.windows })}
            </Text>
          </div>
        ))}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>🛡</span>{t('wizard.step.safety')}</>}>
        {capacityLoading ? (
          <Text type="secondary">{t('campaign.wizard.calculating')}</Text>
        ) : capacity ? (
          <>
            <Progress
              percent={capacityPct}
              strokeColor={safeColor}
              trailColor="#f0f0f0"
              showInfo={false}
              style={{ marginBottom: 8 }}
            />
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              {t('wizard.safety.targetCount')}: <strong>{capacity.targetCount}</strong>
            </div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              {t('wizard.safety.matureAccounts')}: <strong>{capacity.matureAccountCount}</strong> / {capacity.totalAccountCount}
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {t('wizard.safety.capacity')}: <strong>{capacity.capacity}</strong>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                (= {capacity.matureAccountCount} × {capacity.dailyLimit})
              </Text>
            </div>
            {capacity.safetyLevel !== 'safe' && (
              <Alert
                type={capacity.safetyLevel === 'warning' ? 'warning' : 'error'}
                showIcon
                message={capacity.message}
                description={capacity.safetyLevel === 'risk' ? t('wizard.safety.suggestion') : undefined}
                style={{ fontSize: 12 }}
              />
            )}
            {capacity.safetyLevel === 'safe' && (
              <Alert type="success" showIcon message={capacity.message} style={{ fontSize: 12 }} />
            )}
          </>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>{t('campaign.wizard.calculating')}</Text>
        )}
      </Card>
    </div>
  );
}

// ── Step 4: 确认启动 ──────────────────────────────────────────────────

interface DispatchPreview {
  targetCount: number;
  accountsUsed: number;
  days: number;
  tasksTotal: number;
  dailyLimit: number;
  pacePreset: string;
  fastPath?: boolean;
  schedule: Array<{
    day: number;
    date: string;
    windows: Array<{ label: string; count: number; firstAt: string; lastAt: string }>;
    dayTotal: number;
  }>;
}

function DispatchPreviewCard({ state }: { state: WizardState }) {
  const t = useT();
  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prevKeyRef = useRef('');

  useEffect(() => {
    const key = JSON.stringify({
      customerGroupIds: state.customerGroupIds,
      targets: state.targets,
      pacePreset: state.pacePreset,
      accountSourceMode: state.accountSourceMode,
      adAccountIds: state.adAccountIds,
      scheduleMode: state.scheduleMode,
    });
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const extraTargets = state.targets.trim().split(/\n+/).filter(Boolean);
    const hasTargets = state.customerGroupIds.length > 0 || extraTargets.length > 0;
    if (!hasTargets) {
      setPreview(null);
      return;
    }

    setLoading(true);
    setErr(null);
    campaignsApi.previewDispatch({
      customerGroupIds: state.customerGroupIds,
      targets: extraTargets,
      pacePreset: state.pacePreset,
      accountSourceMode: state.accountSourceMode,
      adAccountIds: state.adAccountIds,
      scheduleMode: state.scheduleMode,
      // Codex round-5 #4: preview 也按真实调度参数算时间
      scheduledAt: (state as any).scheduledAt,
      scheduleTime: (state as any).scheduleTime,
      scheduleDayOfWeek: (state as any).scheduleDayOfWeek,
    }).then(res => {
      setPreview(res.data);
    }).catch(() => {
      setErr(t('msg.loadFailed'));
    }).finally(() => setLoading(false));
  }, [state.customerGroupIds, state.targets, state.pacePreset, state.accountSourceMode, state.adAccountIds, state.scheduleMode, (state as any).scheduledAt, (state as any).scheduleTime, (state as any).scheduleDayOfWeek]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <Card
      size="small"
      style={{ marginTop: 12, background: '#f6ffed', borderColor: '#b7eb8f' }}
      bodyStyle={{ padding: '10px 14px' }}
      title={
        <Space style={{ fontSize: 13 }}>
          <ScheduleOutlined style={{ color: '#52c41a' }} />
          <span style={{ fontWeight: 600 }}>{t('wizard.preview.title')}</span>
          {loading && <Spin size="small" />}
        </Space>
      }
    >
      {err && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{err}</div>}
      {!loading && !err && preview && preview.tasksTotal === 0 && (
        <div style={{ color: '#999', fontSize: 12 }}>{t('common.none')}</div>
      )}
      {!loading && !err && preview && preview.tasksTotal > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
            <Tag color="green">{t('wizard.preview.targets')} {preview.targetCount}</Tag>
            <Tag color="blue">{preview.accountsUsed} {t('common.role')}</Tag>
            {preview.fastPath
              ? <Tag color="orange" icon={<ThunderboltOutlined />}>{t('campaign.wizard.schedule.immediate')}</Tag>
              : <Tag color="purple">{t('wizard.preview.spanDays', { n: preview.days })}</Tag>}
            <Tag>{t('wizard.preview.totalTasks', { n: preview.tasksTotal })}</Tag>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {preview.schedule.map(day => (
              <div key={day.day} style={{ border: '1px solid #d9f7be', borderRadius: 6, padding: '6px 10px', background: '#fff' }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                  {preview.fastPath ? t('wizard.preview.upcoming') : `Day ${day.day + 1} (${day.date})`}
                  <span style={{ fontWeight: 400, color: '#999', marginLeft: 8 }}>{day.dayTotal}</span>
                </div>
                {day.windows.map((w, wi) => (
                  <div key={wi} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#555', marginBottom: 2 }}>
                    <span style={{ color: w.label === '立即发送' ? '#fa8c16' : '#1677ff', minWidth: 110 }}>{w.label}</span>
                    <span>{w.count}</span>
                    <span style={{ color: '#aaa' }}>{fmt(w.firstAt)} → {fmt(w.lastAt)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {!loading && !err && !preview && (
        <div style={{ color: '#aaa', fontSize: 12 }}>{t('common.none')}</div>
      )}
    </Card>
  );
}

function Step4({
  state, capacity, customerGroups, adTemplates, greetingTemplates,
}: {
  state: WizardState;
  capacity: any;
  customerGroups: any[];
  adTemplates: any[];
  greetingTemplates: any[];
}) {
  const t = useT();
  const groupNames = customerGroups
    .filter(g => state.customerGroupIds.includes(g.id))
    .map(g => `${g.name} (${g.memberCount})`).join('、') || '—';

  const extraLines = state.targets.trim().split(/\n+/).filter(Boolean);
  const targetDesc = [
    state.customerGroupIds.length ? `${t('drawer.customerGroup')}: ${groupNames}` : '',
    extraLines.length ? `${t('campaign.wizard.summary.extra')}: ${extraLines.length}` : '',
    capacity?.targetCount != null ? `${t('wizard.safety.targetCount')}: ${capacity.targetCount}` : '',
  ].filter(Boolean).join('\n');

  const adDesc = state.adMode === 'single' && state.adTemplateId
    ? `${t('campaign.wizard.adMode.single')}\n· ${adTemplates.find(tpl => tpl.id === state.adTemplateId)?.name ?? state.adTemplateId}`
    : state.adTemplateIds.length
    ? `${t('campaign.wizard.adMode.rotate')}\n${state.adTemplateIds.map(id => `· ${adTemplates.find(tpl => tpl.id === id)?.name ?? id}`).join('\n')}`
    : '—';

  const greetDesc = state.greetingMode === 'none' ? t('campaign.wizard.greetingMode.none')
    : `${state.greetingMode === 'fixed' ? t('campaign.wizard.greetingMode.fixed') : t('campaign.wizard.greetingMode.random')}\n${
      state.greetingTemplateIds.map(id => {
        const g = greetingTemplates.find(x => x.id === id);
        return g ? `· ${g.text.slice(0, 30)}` : '';
      }).filter(Boolean).join('\n')
    }`;

  const execDesc = state.accountSourceMode === 'auto'
    ? t('campaign.wizard.account.auto')
    : `${t('campaign.wizard.account.manual')} (${state.adAccountIds.length})`;

  const safetyLevel = capacity?.safetyLevel;
  const safetyNode = safetyLevel === 'safe'
    ? <Tag color="success">{t('campaign.wizard.safety.safe')}</Tag>
    : safetyLevel === 'warning'
    ? <Tag color="warning">{t('campaign.wizard.safety.warning')}</Tag>
    : <Tag color="error">{t('campaign.wizard.safety.risk')}</Tag>;

  const scheduleText = state.scheduleMode === 'immediate' ? t('campaign.wizard.schedule.immediate')
    : state.scheduleMode === 'once' ? `${t('campaign.wizard.schedule.once')}: ${state.scheduledAt ?? '--'}`
    : state.scheduleMode === 'daily' ? `${t('campaign.wizard.schedule.daily')} ${state.scheduleTime ?? '--'}`
    : `${t('campaign.wizard.schedule.weekly')} ${state.scheduleDayOfWeek != null ? DAY_LABELS[state.scheduleDayOfWeek] : ''} ${state.scheduleTime ?? ''}`;

  const rows = [
    { label: t('wizard.step.name'), value: state.name },
    { label: t('wizard.step.schedule'), value: scheduleText },
    { label: t('wizard.step.targets'), value: targetDesc },
    { label: t('wizard.step.adContent'), value: adDesc },
    { label: t('wizard.step.greeting'), value: greetDesc },
    { label: t('wizard.step.account'), value: execDesc },
    { label: t('wizard.step.pace'), value: t(`pace.${state.pacePreset}`) },
    { label: t('wizard.step.safety'), value: safetyNode, extra: capacity?.message },
  ];

  return (
    <div>
      <Card bodyStyle={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 16px', color: '#999', fontSize: 13, width: 90, verticalAlign: 'top' }}>
                  {r.label}
                </td>
                <td style={{ padding: '10px 16px', fontSize: 13, whiteSpace: 'pre-line' }}>
                  {r.value}
                  {r.extra && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{r.extra}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginTop: 12, background: '#fafafa' }} bodyStyle={{ padding: '10px 16px' }}>
        <div style={{ fontSize: 12, color: '#52c41a' }}>
          ✓ {t('wizard.protection.autoSkip')}<br />
          ✓ {t('wizard.protection.riskPause')}<br />
          ✓ {t('wizard.protection.refillAlert')}<br />
          ✓ {t('wizard.protection.ipNightTakeover')}
        </div>
      </Card>

      <DispatchPreviewCard state={state} />
    </div>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────────

const INITIAL: WizardState = {
  name: '',
  scheduleMode: 'immediate',
  customerGroupIds: [],
  targets: '',
  adMode: 'single',
  adTemplateIds: [],
  greetingMode: 'random',
  greetingTemplateIds: [],
  accountSourceMode: 'auto',
  adAccountIds: [],
  pacePreset: 'conservative',
};

interface Props {
  open: boolean;
  editId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CampaignWizard({ open, editId, onClose, onSuccess }: Props) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [customerGroups, setCustomerGroups] = useState<any[]>([]);
  const [adTemplates, setAdTemplates] = useState<any[]>([]);
  const [greetingTemplates, setGreetingTemplates] = useState<any[]>([]);
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [capacity, setCapacity] = useState<any>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [tenantId, setTenantId] = useState<string>('');

  const onChange = useCallback((patch: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  // 加载真实 tenant UUID
  useEffect(() => {
    if (!open) return;
    tenantsApi.getDefault()
      .then(r => { if (r.data?.id) setTenantId(r.data.id); })
      .catch(() => {});
  }, [open]);

  // Load reference data after tenantId is ready
  useEffect(() => {
    if (!open || !tenantId) return;
    Promise.all([
      customerGroupsApi.list(tenantId),
      adTemplatesApi.list(tenantId),
      greetingTemplatesApi.list(tenantId),
      slotsApi.list(),
    ]).then(([g, a, gr, s]) => {
      setCustomerGroups(Array.isArray(g.data) ? g.data : []);
      setAdTemplates(Array.isArray(a.data) ? a.data : []);
      setGreetingTemplates(Array.isArray(gr.data) ? gr.data : []);
      const slots = Array.isArray(s.data) ? s.data : [];
      setAdAccounts(
        slots
          .filter((sl: any) => sl.account && (sl.account.role === 'ad' || sl.account.role === 'hybrid'))
          .map((sl: any) => sl.account),
      );
    }).catch(() => {});
  }, [open, tenantId]);

  // Load campaign for edit
  useEffect(() => {
    if (!open || !editId) { setState(INITIAL); setStep(0); return; }
    campaignsApi.get(editId).then(r => {
      const c = r.data;
      setState({
        name: c.name ?? '',
        scheduleMode: c.scheduleMode ?? 'immediate',
        scheduledAt: c.scheduledAt ? dayjs(c.scheduledAt).format('YYYY-MM-DDTHH:mm') : undefined,
        scheduleTime: c.scheduleTime,
        scheduleDayOfWeek: c.scheduleDayOfWeek,
        customerGroupIds: c.customerGroupIds ?? [],
        targets: (c.targets ?? []).join('\n'),
        adMode: c.adTemplateIds?.length > 1 ? 'rotate' : 'single',
        adTemplateId: c.adTemplateId,
        adTemplateIds: c.adTemplateIds ?? [],
        greetingMode: c.greetingMode ?? 'random',
        greetingTemplateIds: c.greetingTemplateIds ?? [],
        accountSourceMode: c.accountSourceMode ?? 'auto',
        adAccountIds: c.adAccountIds ?? [],
        pacePreset: c.pacePreset ?? 'conservative',
      });
    }).catch(() => {});
  }, [open, editId]);

  // Capacity check whenever relevant fields change
  useEffect(() => {
    if (!open) return;
    const extraTargets = state.targets.trim().split(/\n+/).filter(Boolean);
    const totalManual = extraTargets.length;
    const totalGroup = customerGroups
      .filter(g => state.customerGroupIds.includes(g.id))
      .reduce((s, g) => s + (g.memberCount ?? 0), 0);
    const targetCount = totalGroup + totalManual;

    if (targetCount === 0 && state.customerGroupIds.length === 0) {
      setCapacity(null);
      return;
    }

    setCapacityLoading(true);
    campaignsApi.capacityCheck({
      targetCount,
      pacePreset: state.pacePreset,
      customerGroupIds: state.customerGroupIds,
      extraTargets,
    }).then(r => {
      setCapacity(r.data);
    }).catch(() => setCapacity(null)).finally(() => setCapacityLoading(false));
  }, [open, state.customerGroupIds, state.targets, state.pacePreset, customerGroups]);

  // Validation per step
  const canNext = useMemo(() => {
    if (step === 0) {
      return state.name.trim().length > 0
        && (state.customerGroupIds.length > 0 || state.targets.trim().length > 0);
    }
    if (step === 1) {
      const adSelected = state.adMode === 'single' ? !!state.adTemplateId : state.adTemplateIds.length > 0;
      return adSelected;
    }
    return true;
  }, [step, state]);

  const buildPayload = () => {
    const extraTargets = state.targets.trim().split(/\n+/).filter(Boolean);
    return {
      tenantId,
      name: state.name,
      scheduleMode: state.scheduleMode,
      scheduledAt: state.scheduleMode !== 'immediate' ? state.scheduledAt : undefined,
      scheduleTime: ['daily', 'weekly'].includes(state.scheduleMode) ? state.scheduleTime : undefined,
      scheduleDayOfWeek: state.scheduleMode === 'weekly' ? state.scheduleDayOfWeek : undefined,
      customerGroupIds: state.customerGroupIds,
      targets: extraTargets,
      adTemplateId: state.adMode === 'single' ? state.adTemplateId : undefined,
      adTemplateIds: state.adMode === 'rotate' ? state.adTemplateIds : undefined,
      greetingMode: state.greetingMode,
      greetingTemplateIds: state.greetingMode !== 'none' ? state.greetingTemplateIds : [],
      accountSourceMode: state.accountSourceMode,
      adAccountIds: state.accountSourceMode === 'manual' ? state.adAccountIds : [],
      pacePreset: state.pacePreset,
    };
  };

  const handleSaveDraft = async () => {
    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (editId) {
        await campaignsApi.update(editId, payload);
      } else {
        await campaignsApi.create(payload);
      }
      antdMessage.success('已保存草稿');
      onSuccess();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doLaunch = async () => {
    setSubmitting(true);
    try {
      const payload = buildPayload();
      let id = editId;
      if (id) {
        await campaignsApi.update(id, payload);
      } else {
        const res = await campaignsApi.create(payload);
        id = res.data.id;
      }
      // /send 接口会自动把 status 改 running 并跑 dispatch
      if (id) {
        const sendRes = await campaignsApi.send(id);
        const { tasksCreated, days, accountsUsed } = sendRes.data ?? {};
        antdMessage.success(
          `✓ 已开始投放！${tasksCreated ? ` 生成 ${tasksCreated} 个任务` : ''}` +
          `${accountsUsed ? ` · ${accountsUsed} 个号` : ''}` +
          `${days && days > 1 ? ` · 跨 ${days} 天` : ''}`,
        );
      } else {
        antdMessage.success('已开始投放！');
      }
      onSuccess();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      antdMessage.error(Array.isArray(msg) ? msg.join('; ') : msg ?? '启动失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLaunch = () => {
    if (capacity?.safetyLevel === 'risk') {
      Modal.confirm({
        title: t('wizard.forceLaunchConfirm.title'),
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>{capacity?.message}</div>
          </div>
        ),
        okText: t('wizard.forceLaunch'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: doLaunch,
      });
      return;
    }
    void doLaunch();
  };

  const handleClose = () => {
    setState(INITIAL);
    setStep(0);
    setCapacity(null);
    onClose();
  };

  const STEPS = [
    t('wizard.stepTitle.targets'),
    t('wizard.stepTitle.adContent'),
    t('wizard.stepTitle.policy'),
    t('wizard.stepTitle.confirm'),
  ];
  const STEP_DESCS = [
    t('campaign.wizard.step.targetDesc'),
    t('campaign.wizard.step.adDesc'),
    t('campaign.wizard.step.policyDesc'),
    t('campaign.wizard.step.confirmDesc'),
  ];

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {editId ? t('common.edit') + ' ' + t('nav.campaigns') : t('page.campaigns.create')}
        </div>
      }
      width={900}
      footer={null}
      closeIcon={<CloseOutlined />}
      destroyOnClose
    >
      {/* Steps header */}
      <Steps
        current={step}
        style={{ marginBottom: 20 }}
        size="small"
        items={STEPS.map((s, i) => ({ title: s, description: STEP_DESCS[i] }))}
      />

      <Row gutter={16}>
        {/* Main content */}
        <Col span={16} style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 8 }}>
          {step === 0 && <Step1 state={state} onChange={onChange} customerGroups={customerGroups} />}
          {step === 1 && <Step2 state={state} onChange={onChange} adTemplates={adTemplates} greetingTemplates={greetingTemplates} />}
          {step === 2 && <Step3 state={state} onChange={onChange} adAccounts={adAccounts} capacity={capacity} capacityLoading={capacityLoading} />}
          {step === 3 && <Step4 state={state} capacity={capacity} customerGroups={customerGroups} adTemplates={adTemplates} greetingTemplates={greetingTemplates} />}
        </Col>

        {/* Summary panel */}
        <Col span={8}>
          <SummaryPanel
            state={state}
            capacity={capacity}
            customerGroups={customerGroups}
            adTemplates={adTemplates}
            greetingTemplates={greetingTemplates}
          />
        </Col>
      </Row>

      <Divider style={{ margin: '12px 0' }} />

      {/* Footer buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button onClick={step === 0 ? handleClose : () => setStep(s => s - 1)}>
          {step === 0 ? t('common.cancel') : t('common.back')}
        </Button>
        <Space>
          {step < 3 && (
            <Button
              type="primary"
              disabled={!canNext}
              onClick={() => setStep(s => s + 1)}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            >
              {t('common.next')} →
            </Button>
          )}
          {step === 3 && (
            <>
              <Button onClick={handleSaveDraft} loading={submitting}>{t('common.draft')}</Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleLaunch}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
              >
                {capacity?.safetyLevel === 'risk' ? t('wizard.forceLaunch') : t('wizard.launch')}
              </Button>
            </>
          )}
        </Space>
      </div>
    </Modal>
  );
}
