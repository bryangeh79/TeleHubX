import { logger } from '../logger';

// How long to wait for a human to enter the verification code before giving up
const CODE_TIMEOUT_MS = 5 * 60_000;

type CodeResolver = (code: string) => void;

// AuthCodeHandler bridges GramJS's code callback with an external code delivery
// mechanism (e.g. a WebSocket command from the server dashboard).
//
// Usage:
//   const handler = new AuthCodeHandler();
//   await client.start({ phoneCode: handler.makeCodeCallback(), ... });
//
// When the server receives the code from the user:
//   handler.submitCode(phoneCodeHash, '12345');
export class AuthCodeHandler {
  private pending = new Map<string, CodeResolver>();

  // Returns a function matching GramJS's `phoneCode` callback signature.
  // Parks itself in the pending map until submitCode() is called or timeout fires.
  makeCodeCallback(): (phoneCodeHash: string) => Promise<string> {
    return (phoneCodeHash: string): Promise<string> => {
      logger.warn(`[AuthCode] Verification code requested — hash: ${phoneCodeHash}`);
      return new Promise<string>((resolve) => {
        this.pending.set(phoneCodeHash, resolve);
        setTimeout(() => {
          if (this.pending.has(phoneCodeHash)) {
            this.pending.delete(phoneCodeHash);
            // Resolve with empty string — GramJS will surface an AUTH_CODE_INVALID error
            // which the caller can catch and treat as a timeout
            resolve('');
            logger.error(`[AuthCode] Code input timed out for hash ${phoneCodeHash}`);
          }
        }, CODE_TIMEOUT_MS);
      });
    };
  }

  // Called by the server relay (WebSocket / REST) when the user submits their code.
  // Returns true if the hash was pending, false if it was already resolved / unknown.
  submitCode(phoneCodeHash: string, code: string): boolean {
    const resolve = this.pending.get(phoneCodeHash);
    if (!resolve) return false;
    this.pending.delete(phoneCodeHash);
    resolve(code);
    logger.info(`[AuthCode] Code submitted for hash ${phoneCodeHash}`);
    return true;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  pendingHashes(): string[] {
    return Array.from(this.pending.keys());
  }
}
