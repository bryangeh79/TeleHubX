/**
 * Auto-Recovery 系统: 错误分类 label / 颜色 / 提示字典.
 * 与 apps/agent/src/tasks/error-classifier.ts 中的 ErrorClass 对应.
 *
 * 在 SchedulerPage 任务详情对话框 + 任务列表错误列使用.
 */

export type ErrorClass = 'A' | 'B' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface ErrorClassMeta {
  label: string;
  color: string; // antd Tag color
  hint: string;
  permanent: boolean;
}

export const ERROR_CLASS_META: Record<ErrorClass, ErrorClassMeta> = {
  A: {
    label: '网络瞬时',
    color: 'blue',
    hint: '网络抖动, 系统已自动重试',
    permanent: false,
  },
  B: {
    label: '连接已断',
    color: 'cyan',
    hint: '账号连接掉线, 系统已重连并自动重试',
    permanent: false,
  },
  D: {
    label: 'FloodWait 限速',
    color: 'orange',
    hint: '账号已自动隔离, 等待 TG 限速结束后会自动恢复',
    permanent: false,
  },
  E: {
    label: '临时风控',
    color: 'gold',
    hint: '账号触发临时风控, 建议降频或停广告 24h 后手动重试',
    permanent: false,
  },
  F: {
    label: '目标拒绝/不存在',
    color: 'red',
    hint: '此目标无法触达 (隐私/不存在/被拉黑), 请检查群/账号是否有效',
    permanent: true,
  },
  G: {
    label: '账号已失效',
    color: 'volcano',
    hint: '账号 session 已失效或被封, 请到账号管理重新登录',
    permanent: true,
  },
  H: {
    label: '系统错误',
    color: 'default',
    hint: '未知错误, 请查看错误详情或联系管理员',
    permanent: false,
  },
};

export function getErrorClassMeta(cls?: string | null): ErrorClassMeta | null {
  if (!cls) return null;
  return ERROR_CLASS_META[cls as ErrorClass] ?? null;
}
