/**
 * 任务执行错误分类器 (Auto-Recovery Layer)
 *
 * 设计原则:
 * - 把 GramJS / 网络 / 业务错误映射到 8 类 (A-H), 让 task-runner 决定:
 *   * 是否自动重试 (retryable)
 *   * 重试前是否需要重连账号 (needReconnect)
 *   * 是否标账号 banned (quarantineAccount, 仅 G 类)
 *   * 是否永久错误 (permanent, 用于 dashboard 区分)
 *   * 给用户什么 hint
 *
 * 用户决策 (保守):
 * - 仅 A (网络瞬时) + B (连接已断) 自动重试
 * - E (PEER_FLOOD 等临时风控) 不自动重试, 仅标黄
 * - F/G/H 永久错误立即 fail, 不重试
 * - D (FloodWait) 走原有 quarantine 路径, 不进入新分类器
 */

export type ErrorClass = 'A' | 'B' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface ClassifiedError {
  /** 分类码 */
  class: ErrorClass;
  /** 中文展示 label */
  classLabel: string;
  /** 是否可被 task-runner 自动重试 */
  retryable: boolean;
  /** 重试前是否调 client.connect() */
  needReconnect: boolean;
  /** 是否永久错误 (UI 用以区分 "重试也没用" 的情况) */
  permanent: boolean;
  /** 是否需要把账号标为 banned */
  quarantineAccount: boolean;
  /** 给用户的恢复建议 */
  hint: string;
}

/**
 * 把任意 Error 分类。如果都不匹配, 默认 H (系统/未知)。
 *
 * 注意: D 类 (FloodWait) 也在这里识别, 但 task-runner 应该先走原有 parseFloodWaitSeconds
 * 路径, 不应进入新的 retry 分支 — 此函数 D 类的 retryable=false 是正确的, 因为 quarantine
 * 已经处理了恢复。
 */
export function classifyError(err: Error | unknown): ClassifiedError {
  const msg = (err instanceof Error ? err.message : String(err)) ?? '';

  // ─── D: FloodWait (已有 quarantine, 不进 retry 分支) ────────────────
  if (/A wait of \d+ seconds is required|FLOOD_WAIT_\d+/i.test(msg)) {
    return {
      class: 'D',
      classLabel: 'FloodWait 限速',
      retryable: false,
      needReconnect: false,
      permanent: false,
      quarantineAccount: false,
      hint: '账号已自动隔离, 等待 TG 限速结束后会自动恢复',
    };
  }

  // ─── G: 账号失效 (必须人工重登) ────────────────────────────────────
  if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|USER_DEACTIVATED_BAN|SESSION_PASSWORD_NEEDED/i.test(msg)) {
    return {
      class: 'G',
      classLabel: '账号已失效',
      retryable: false,
      needReconnect: false,
      permanent: true,
      quarantineAccount: true,
      hint: '账号 session 已失效或被封, 请到账号管理重新登录',
    };
  }

  // ─── F: 永久业务错误 (重试也不会成功) ──────────────────────────────
  if (/USER_PRIVACY_RESTRICTED|CHAT_WRITE_FORBIDDEN|PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|USERNAME_NOT_OCCUPIED|USERNAME_INVALID|PEER_ID_INVALID|CHANNEL_PRIVATE|CHANNEL_INVALID|MESSAGE_TOO_LONG|MEDIA_EMPTY|FILE_REFERENCE_EXPIRED|INVITE_HASH_EXPIRED|INVITE_HASH_INVALID|USER_NOT_PARTICIPANT|CHAT_ADMIN_REQUIRED|YOU_BLOCKED_USER|USER_IS_BLOCKED/i.test(msg)) {
    return {
      class: 'F',
      classLabel: '目标拒绝/不存在',
      retryable: false,
      needReconnect: false,
      permanent: true,
      quarantineAccount: false,
      hint: '此目标无法触达 (隐私/不存在/被拉黑), 请检查群/账号是否有效',
    };
  }

  // ─── E: 临时风控 (用户选保守, 不自动重试, 仅标黄) ──────────────────
  if (/PEER_FLOOD|SLOWMODE_WAIT|CHAT_SEND_PLAIN_FORBIDDEN|CHAT_SEND_MEDIA_FORBIDDEN|CHAT_RESTRICTED/i.test(msg)) {
    return {
      class: 'E',
      classLabel: '临时风控',
      retryable: false,
      needReconnect: false,
      permanent: false,
      quarantineAccount: false,
      hint: '账号触发临时风控, 建议降频或停广告 24h 后手动重试',
    };
  }

  // ─── B: 连接已断 (重连后重试) ──────────────────────────────────────
  if (/Connection closed|WebSocket connection failed|Connection (was )?closed while|Disconnected|Cannot read prop.*of (?:null|undefined)|connection (?:dropped|lost)|EPIPE|network is down/i.test(msg)) {
    return {
      class: 'B',
      classLabel: '连接已断',
      retryable: true,
      needReconnect: true,
      permanent: false,
      quarantineAccount: false,
      hint: '账号连接掉线, 系统已重连并自动重试',
    };
  }

  // ─── A: 网络瞬时 (直接重试, 不重连) ─────────────────────────────────
  if (/RPC timeout|^TIMEOUT$|\bTIMEOUT\b|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network timeout|timed out|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|Server returned -503/i.test(msg)) {
    return {
      class: 'A',
      classLabel: '网络瞬时',
      retryable: true,
      needReconnect: false,
      permanent: false,
      quarantineAccount: false,
      hint: '网络抖动, 系统已自动重试',
    };
  }

  // ─── H: 默认兜底 (系统/未知) ──────────────────────────────────────
  return {
    class: 'H',
    classLabel: '系统错误',
    retryable: false,
    needReconnect: false,
    permanent: false,
    quarantineAccount: false,
    hint: '未知错误, 请查看错误详情或联系管理员',
  };
}
