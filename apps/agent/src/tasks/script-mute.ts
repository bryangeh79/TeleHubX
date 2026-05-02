/**
 * 剧本静默管理器（agent 进程内存级）
 *
 * 用途：当某个账号正在执行 chat_script_ab / chat_script_4p 任务时，
 * 临时屏蔽该账号的「自动回复」逻辑（cs 智能客服 / ad FAQ）。
 *
 * 这样即使群里有真人 @ 该号，message-handler 也不会触发自动回复，
 * 让账号能"专心"按剧本说话，避免说出剧本之外的话造成穿帮。
 */

const mutedAccounts = new Set<string>();

export function muteAccount(accountId: string): void {
  if (!accountId) return;
  mutedAccounts.add(accountId);
}

export function unmuteAccount(accountId: string): void {
  if (!accountId) return;
  mutedAccounts.delete(accountId);
}

export function isAccountMuted(accountId: string): boolean {
  return mutedAccounts.has(accountId);
}

/** 调试用：当前所有被静默的账号 */
export function listMutedAccounts(): string[] {
  return [...mutedAccounts];
}
