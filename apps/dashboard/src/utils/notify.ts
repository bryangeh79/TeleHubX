/**
 * Browser desktop notification helpers.
 * Permission API: granted | denied | default.
 */

const STORAGE_KEY_DECLINED = 'telehubx:notify-permission-declined';

export function isNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notifyPermission(): NotificationPermission | 'unsupported' {
  if (!isNotifySupported()) return 'unsupported';
  return Notification.permission;
}

export function userDeclinedPrompt(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_DECLINED) === 'true'; } catch { return false; }
}

export function rememberDecline(): void {
  try { localStorage.setItem(STORAGE_KEY_DECLINED, 'true'); } catch { /* ignore */ }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotifySupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    const result = await Notification.requestPermission();
    if (result === 'denied') rememberDecline();
    return result;
  } catch {
    return 'denied';
  }
}

export interface NotifyOptions {
  title: string;
  body: string;
  /** Optional click handler — fires when user clicks the notification body. */
  onClick?: () => void;
  /** Override icon (defaults to favicon) */
  icon?: string;
  /** Tag — same tag merges/replaces previous notification with same tag */
  tag?: string;
}

export function notifyDesktop(opts: NotifyOptions): Notification | null {
  if (!isNotifySupported() || Notification.permission !== 'granted') return null;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? '/favicon.ico',
      tag: opts.tag,
    });
    if (opts.onClick) {
      n.onclick = (e) => {
        e.preventDefault();
        window.focus();
        opts.onClick!();
        n.close();
      };
    }
    // Auto-close after 8s
    setTimeout(() => n.close(), 8000);
    return n;
  } catch {
    return null;
  }
}

/**
 * Play a short notification beep using Web Audio API (no asset needed).
 * Browsers may block until user interaction; we catch and ignore.
 */
export function playSound(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    // Two-tone "ding": 880Hz then 1320Hz
    setTimeout(() => { o.frequency.value = 1320; }, 120);
    setTimeout(() => { o.stop(); ctx.close().catch(() => {}); }, 280);
  } catch {
    /* ignore */
  }
}
