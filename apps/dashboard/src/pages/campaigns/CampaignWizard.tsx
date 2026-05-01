import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Checkbox, Col, Descriptions, Divider,
  Form, Input, Modal, Progress, Radio, Row, Select, Space, Steps,
  Tag, Tooltip, Typography, message as antdMessage,
} from 'antd';
import {
  CalendarOutlined, CloseOutlined, InfoCircleOutlined,
  ReloadOutlined, SafetyOutlined, ThunderboltOutlined, UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adTemplatesApi, campaignsApi, customerGroupsApi,
  greetingTemplatesApi, slotsApi, tenantsApi,
} from '../../services/api';

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
  conservative: { label: '保守', daily: 20, windows: 3, tag: '推荐' },
  balanced:     { label: '平衡', daily: 30, windows: 3 },
  aggressive:   { label: '投放', daily: 40, windows: 2 },
};

const SCHEDULE_OPTIONS: { value: ScheduleMode; label: string; icon: React.ReactNode }[] = [
  { value: 'immediate', label: '立即开始', icon: <ThunderboltOutlined /> },
  { value: 'once',      label: '单次定时', icon: <CalendarOutlined /> },
  { value: 'daily',     label: '每天',     icon: <ReloadOutlined /> },
  { value: 'weekly',    label: '每周',     icon: <CalendarOutlined /> },
];

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
  const safetyColor = capacity?.safetyLevel === 'safe' ? '#52c41a'
    : capacity?.safetyLevel === 'warning' ? '#faad14'
    : capacity?.safetyLevel === 'risk' ? '#ff4d4f'
    : '#d9d9d9';

  const safetyLabel = capacity?.safetyLevel === 'safe' ? '可启动'
    : capacity?.safetyLevel === 'warning' ? '有风险'
    : capacity?.safetyLevel === 'risk' ? '承载不足'
    : '准备配置中';

  const scheduleText = state.scheduleMode === 'immediate' ? '立即开始'
    : state.scheduleMode === 'once' ? `定时: ${state.scheduledAt ?? '--'}`
    : state.scheduleMode === 'daily' ? `每天 ${state.scheduleTime ?? '--'}`
    : state.scheduleDayOfWeek != null
      ? `每周${DAY_LABELS[state.scheduleDayOfWeek]} ${state.scheduleTime ?? ''}`
      : '每周 --';

  const groupNames = customerGroups
    .filter(g => state.customerGroupIds.includes(g.id))
    .map(g => g.name).join(', ') || '—';

  const extraCount = state.targets.trim().split(/\n+/).filter(Boolean).length;

  const adText = state.adMode === 'single' && state.adTemplateId
    ? `1 条 · 单一`
    : state.adTemplateIds.length
    ? `${state.adTemplateIds.length} 条 · 轮换`
    : '—';

  const greetText = state.greetingMode === 'none' ? '不加开场'
    : state.greetingMode === 'fixed' ? `固定 · ${state.greetingTemplateIds.length} 条`
    : `随机 · ${state.greetingTemplateIds.length} 条`;

  return (
    <Card
      title="本次投放摘要"
      size="small"
      extra={<Badge color={safetyColor} text={<Text style={{ fontSize: 12, color: safetyColor }}>{safetyLabel}</Text>} />}
      style={{ position: 'sticky', top: 0 }}
    >
      <Descriptions column={1} size="small" labelStyle={{ color: '#999', width: 70 }}>
        <Descriptions.Item label="名称">{state.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="时间">{scheduleText}</Descriptions.Item>
        <Descriptions.Item label="客户群">{groupNames}</Descriptions.Item>
        <Descriptions.Item label="补充号码">{extraCount > 0 ? `${extraCount} 个` : '—'}</Descriptions.Item>
        <Descriptions.Item label="广告">{adText}</Descriptions.Item>
        <Descriptions.Item label="开场">{greetText}</Descriptions.Item>
        <Descriptions.Item label="执行方式">{state.accountSourceMode === 'auto' ? '系统智能' : `自定义槽位 (${state.adAccountIds.length})`}</Descriptions.Item>
        <Descriptions.Item label="节奏">{PACE_INFO[state.pacePreset].label}</Descriptions.Item>
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
  const hasTarget = state.customerGroupIds.length > 0 || state.targets.trim().length > 0;
  return (
    <div>
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>Aa</span>投放名称</>} style={{ marginBottom: 12 }}>
        <Input
          value={state.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="例: 五月产品推广"
          maxLength={50}
          showCount
        />
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>⏱</span>发送时间</>} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCHEDULE_OPTIONS.map(opt => (
            <div
              key={opt.value}
              onClick={() => onChange({ scheduleMode: opt.value })}
              style={{
                flex: 1, minWidth: 100, border: `1px solid ${state.scheduleMode === opt.value ? '#52c41a' : '#d9d9d9'}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'center',
                background: state.scheduleMode === opt.value ? '#f6ffed' : '#fff',
                color: state.scheduleMode === opt.value ? '#52c41a' : '#333',
              }}
            >
              <div style={{ fontSize: 18 }}>{opt.icon}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{opt.label}</div>
              {state.scheduleMode === opt.value && (
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
                placeholder="星期"
              />
            )}
            <Input
              type="time"
              style={{ width: 120 }}
              value={state.scheduleTime}
              onChange={e => onChange({ scheduleTime: e.target.value })}
              placeholder="发送时间"
            />
          </div>
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>👥</span>目标号码</>} style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 13 }}>选择客户群 (可多选)：</Text>
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 4 }}
            placeholder="从已有客户群中选择"
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
          <Text style={{ fontSize: 13 }}>手动补充号码 (可选)：</Text>
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
            message="请至少选择一个客户群或填入手动号码，否则无法继续"
            style={{ marginTop: 8 }}
          />
        )}
        <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
          说明：系统会在你的成熟营运号 (完成 14 天养号) 之间均匀分配，按节流档位打散时段。
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
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>📣</span>广告文案</>} style={{ marginBottom: 12 }}>
        <Radio.Group
          value={state.adMode}
          onChange={e => onChange({ adMode: e.target.value, adTemplateId: undefined, adTemplateIds: [] })}
          style={{ marginBottom: 12 }}
        >
          <Radio value="single">单一广告</Radio>
          <Radio value="rotate">多广告轮换</Radio>
        </Radio.Group>

        {adTemplates.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="还没有广告模板。请先在「广告模板库」添加。"
            description="新建广告模板后，返回这里就可以选择。"
          />
        ) : (
          <Row gutter={[8, 8]}>
            {adTemplates.map(t => {
              const selected = selectedAds.includes(t.id);
              return (
                <Col span={12} key={t.id}>
                  <div
                    onClick={() => toggleAd(t.id)}
                    style={{
                      border: `1px solid ${selected ? '#52c41a' : '#d9d9d9'}`,
                      borderRadius: 8, padding: 12, cursor: 'pointer',
                      background: selected ? '#f6ffed' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Checkbox checked={selected} onChange={() => toggleAd(t.id)} />
                      {t.hasMedia && <Tag color="green" style={{ fontSize: 11 }}>含素材</Tag>}
                    </div>
                    <Text strong style={{ fontSize: 13 }}>{t.name}</Text>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}
                      </Text>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      最近修改: {dayjs(t.updatedAt).format('YYYY/M/D')}
                    </Text>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}

        {noAd && adTemplates.length > 0 && (
          <Alert type="warning" showIcon message="请至少选择 1 条广告" style={{ marginTop: 8 }} />
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>💬</span>开场白</>}>
        <Text style={{ fontSize: 13, fontWeight: 500 }}>步骤 1 · 选择开场模式</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 16 }}>
          {([
            { value: 'fixed' as const, label: '固定开场 (选 1 条)', sub: '每次发送相同的开场白', tag: '' },
            { value: 'random' as const, label: '随机开场', sub: '从已选文案中随机发送，更自然', tag: '推荐' },
            { value: 'none' as const, label: '不加开场', sub: '直接发送广告正文', tag: '' },
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
              <Text style={{ fontSize: 13, fontWeight: 500 }}>步骤 2 · 选择开场文案</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                已选 {state.greetingTemplateIds.length}/{state.greetingMode === 'fixed' ? '1' : '∞'}
                {state.greetingMode === 'random' && ' (至少选 2 条)'}
              </Text>
            </div>
            {greetingTemplates.length === 0 ? (
              <Alert type="info" showIcon message="还没有开场白模板，请先在「开场白库」添加。" />
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
                message="随机开场建议选 2 条以上，这样对陌生客户更像真人多样化"
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
  const safeColor = capacity?.safetyLevel === 'safe' ? '#52c41a'
    : capacity?.safetyLevel === 'warning' ? '#faad14' : '#ff4d4f';
  const capacityPct = capacity
    ? Math.min(100, Math.round((capacity.capacity / Math.max(capacity.targetCount, 1)) * 100))
    : 0;

  return (
    <div>
      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>👤</span>账号来源</>} style={{ marginBottom: 12 }}>
        {([
          {
            value: 'auto' as const,
            label: '系统智能安排',
            sub: '自动调用成熟营运号 · 自动分配对象 · 自动打散时段 · 自动跳过异常账号',
            tag: '推荐',
          },
          {
            value: 'manual' as const,
            label: '自定义槽位',
            sub: '自定义不关闭智能调度 · 风险管控和异常保护仍然启用',
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
            placeholder="选择执行账号"
            value={state.adAccountIds}
            onChange={v => onChange({ adAccountIds: v })}
            options={adAccounts.map((a: any) => ({
              value: a.id,
              label: `${a.phoneNumber} (${a.role})`,
            }))}
          />
        )}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>⚡</span>节奏档位</>} style={{ marginBottom: 12 }}>
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
              <span style={{ fontWeight: 500 }}>{info.label}</span>
              {info.tag && <Tag color="green" style={{ fontSize: 11 }}>{info.tag}</Tag>}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每号每天 {info.daily} 条 · {info.windows} 时段分发
            </Text>
          </div>
        ))}
      </Card>

      <Card title={<><span style={{ background: '#52c41a', color: '#fff', borderRadius: 4, padding: '1px 6px', marginRight: 8, fontSize: 12 }}>🛡</span>安全承载</>}>
        {capacityLoading ? (
          <Text type="secondary">计算中…</Text>
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
              目标人数: <strong>{capacity.targetCount}</strong>
            </div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              可用成熟号: <strong>{capacity.matureAccountCount}</strong> / 总 {capacity.totalAccountCount}
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              承载: <strong>{capacity.capacity}</strong>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                (= {capacity.matureAccountCount} × {capacity.dailyLimit} × 1 天)
              </Text>
            </div>
            {capacity.safetyLevel !== 'safe' && (
              <Alert
                type={capacity.safetyLevel === 'warning' ? 'warning' : 'error'}
                showIcon
                message={capacity.message}
                description={capacity.safetyLevel === 'risk'
                  ? '建议：增加执行账号 / 减少投放数量 / 拉长时间 (改每天或每周)'
                  : undefined}
                style={{ fontSize: 12 }}
              />
            )}
            {capacity.safetyLevel === 'safe' && (
              <Alert type="success" showIcon message={capacity.message} style={{ fontSize: 12 }} />
            )}
          </>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>设置完目标后自动计算</Text>
        )}
      </Card>
    </div>
  );
}

// ── Step 4: 确认启动 ──────────────────────────────────────────────────

function Step4({
  state, capacity, customerGroups, adTemplates, greetingTemplates,
}: {
  state: WizardState;
  capacity: any;
  customerGroups: any[];
  adTemplates: any[];
  greetingTemplates: any[];
}) {
  const groupNames = customerGroups
    .filter(g => state.customerGroupIds.includes(g.id))
    .map(g => `${g.name} (${g.memberCount})`).join('、') || '—';

  const extraLines = state.targets.trim().split(/\n+/).filter(Boolean);
  const targetDesc = [
    state.customerGroupIds.length ? `客户群: ${groupNames}` : '',
    extraLines.length ? `补充号码: ${extraLines.length} 个` : '',
    capacity?.targetCount != null ? `去重后目标人数: ${capacity.targetCount}` : '',
  ].filter(Boolean).join('\n');

  const adDesc = state.adMode === 'single' && state.adTemplateId
    ? `单一广告\n· ${adTemplates.find(t => t.id === state.adTemplateId)?.name ?? state.adTemplateId}`
    : state.adTemplateIds.length
    ? `多广告轮换\n${state.adTemplateIds.map(id => `· ${adTemplates.find(t => t.id === id)?.name ?? id}`).join('\n')}`
    : '—';

  const greetDesc = state.greetingMode === 'none' ? '不加开场'
    : `${state.greetingMode === 'fixed' ? '固定开场' : '随机开场'}\n${
      state.greetingTemplateIds.map(id => {
        const g = greetingTemplates.find(x => x.id === id);
        return g ? `· ${g.text.slice(0, 30)}` : '';
      }).filter(Boolean).join('\n')
    }`;

  const execDesc = state.accountSourceMode === 'auto'
    ? '系统智能安排'
    : `自定义槽位 · 选了 ${state.adAccountIds.length} 个`;

  const safetyLevel = capacity?.safetyLevel;
  const safetyNode = safetyLevel === 'safe'
    ? <Tag color="success">安全</Tag>
    : safetyLevel === 'warning'
    ? <Tag color="warning">有风险</Tag>
    : <Tag color="error">承载不足</Tag>;

  const scheduleText = state.scheduleMode === 'immediate' ? '立即开始'
    : state.scheduleMode === 'once' ? `定时: ${state.scheduledAt ?? '--'}`
    : state.scheduleMode === 'daily' ? `每天 ${state.scheduleTime ?? '--'}`
    : `每周${state.scheduleDayOfWeek != null ? DAY_LABELS[state.scheduleDayOfWeek] : ''} ${state.scheduleTime ?? ''}`;

  const rows = [
    { label: '投放名称', value: state.name },
    { label: '投放时间', value: scheduleText },
    { label: '投放对象', value: targetDesc },
    { label: '广告内容', value: adDesc },
    { label: '开场方式', value: greetDesc },
    { label: '执行方式', value: execDesc },
    { label: '节奏',     value: PACE_INFO[state.pacePreset].label },
    { label: '安全状态', value: safetyNode, extra: capacity?.message },
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
          ✓ 异常账号自动跳过<br />
          ✓ 风险暂停保护开启<br />
          ✓ 补位不足提醒开启<br />
          ✓ 同 IP 组互斥 · 夜间窗口保护 · 接管中自动跳过
        </div>
      </Card>
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
      const payload = { ...buildPayload(), status: 'draft' };
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
      const payload = { ...buildPayload(), status: 'running' };
      let id = editId;
      if (id) {
        await campaignsApi.update(id, payload);
      } else {
        const res = await campaignsApi.create(payload);
        id = res.data.id;
      }
      if (id) await campaignsApi.send(id);
      antdMessage.success('已开始投放！');
      onSuccess();
    } catch (err: any) {
      antdMessage.error(err?.response?.data?.message ?? '启动失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLaunch = () => {
    if (capacity?.safetyLevel === 'risk') {
      Modal.confirm({
        title: '承载不足，是否仍要强制启动？',
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>{capacity?.message}</div>
            <div style={{ fontSize: 12, color: '#999' }}>
              强制启动后，系统会用现有账号投放，但封号风险较高。<br />
              测试时可以用此选项验证流程，正式投放前建议养号 14 天以上。
            </div>
          </div>
        ),
        okText: '确认强制启动',
        cancelText: '取消',
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

  const STEPS = ['投放对象', '广告内容', '执行方式', '确认启动'];
  const STEP_DESCS = ['设置目标对象', '配置广告素材', '设置执行策略', '确认并启动'];

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {editId ? '编辑广告投放' : '新建广告投放'}
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
          {step === 0 ? '取 消' : '上一步'}
        </Button>
        <Space>
          {step < 3 && (
            <Button
              type="primary"
              disabled={!canNext}
              onClick={() => setStep(s => s + 1)}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            >
              继续: {STEPS[step + 1] ? `设置${STEPS[step + 1]}` : '确认启动'} →
            </Button>
          )}
          {step === 3 && (
            <>
              <Button onClick={handleSaveDraft} loading={submitting}>保存草稿</Button>
              <Button
                type="primary"
                loading={submitting}
                onClick={handleLaunch}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
              >
                {capacity?.safetyLevel === 'risk' ? '强制启动 (承载不足)' : '开始投放'}
              </Button>
            </>
          )}
        </Space>
      </div>
    </Modal>
  );
}
