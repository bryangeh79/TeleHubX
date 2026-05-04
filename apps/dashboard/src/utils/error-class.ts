/**
 * Auto-Recovery 系统: 错误分类 color/permanent 字典 + i18n label/hint 解析.
 * 与 apps/agent/src/tasks/error-classifier.ts 中的 ErrorClass 对应.
 *
 * 在 SchedulerPage 任务详情对话框 + 任务列表错误列使用.
 *
 * label/hint 已迁到 i18n (apps/dashboard/src/i18n/messages.ts):
 *   error.A.label / error.A.hint  ...  error.H.hint
 *
 * 老用法 (zh-only, 无 i18n) 保留兜底, 但建议用 useT() + getErrorClassMetaI18n.
 */

export type ErrorClass = 'A' | 'B' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface ErrorClassMeta {
  /** antd Tag color */
  color: string;
  /** 是否永久错误 */
  permanent: boolean;
}

const ERROR_CLASS_STATIC: Record<ErrorClass, ErrorClassMeta> = {
  A: { color: 'blue',     permanent: false },
  B: { color: 'cyan',     permanent: false },
  D: { color: 'orange',   permanent: false },
  E: { color: 'gold',     permanent: false },
  F: { color: 'red',      permanent: true },
  G: { color: 'volcano',  permanent: true },
  H: { color: 'default',  permanent: false },
};

export function getErrorClassStatic(cls?: string | null): ErrorClassMeta | null {
  if (!cls) return null;
  return ERROR_CLASS_STATIC[cls as ErrorClass] ?? null;
}

/**
 * 解析 errorClass 到完整 meta (含 label / hint, i18n 翻译).
 * 调用方需传入 t() 函数.
 */
export function resolveErrorClassMeta(
  cls: string | null | undefined,
  t: (key: string) => string,
): { class: ErrorClass; color: string; permanent: boolean; label: string; hint: string } | null {
  const stat = getErrorClassStatic(cls);
  if (!stat || !cls) return null;
  return {
    class: cls as ErrorClass,
    color: stat.color,
    permanent: stat.permanent,
    label: t(`error.${cls}.label`),
    hint: t(`error.${cls}.hint`),
  };
}

// ── 老 API 兼容 (zh-only, deprecated) ──────────────────────────────
const ZH_LABELS: Record<ErrorClass, string> = {
  A: '网络瞬时', B: '连接已断', D: 'FloodWait 限速',
  E: '临时风控', F: '目标拒绝/不存在', G: '账号已失效', H: '系统错误',
};
const ZH_HINTS: Record<ErrorClass, string> = {
  A: '网络抖动, 系统已自动重试',
  B: '账号连接掉线, 系统已重连并自动重试',
  D: '账号已自动隔离, 等待 TG 限速结束后会自动恢复',
  E: '账号触发临时风控, 建议降频或停广告 24h 后手动重试',
  F: '此目标无法触达 (隐私/不存在/被拉黑), 请检查群/账号是否有效',
  G: '账号 session 已失效或被封, 请到账号管理重新登录',
  H: '未知错误, 请查看错误详情或联系管理员',
};

/** @deprecated 用 resolveErrorClassMeta(cls, t) 替代以获得 i18n */
export function getErrorClassMeta(cls?: string | null): (ErrorClassMeta & { label: string; hint: string }) | null {
  const stat = getErrorClassStatic(cls);
  if (!stat || !cls) return null;
  const c = cls as ErrorClass;
  return { ...stat, label: ZH_LABELS[c] ?? c, hint: ZH_HINTS[c] ?? '' };
}
