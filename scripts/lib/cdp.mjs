/**
 * A thin CDP client.
 *
 * Only the parts these scripts use are implemented: send a command, wait for
 * the reply, receive events. A command can carry a `sessionId` — in flat
 * session mode a page's commands have to be sent on that page's session.
 *
 * It lives here rather than inside one of the scripts that use it because
 * two of them need it now, and a copy that drifts is a copy that lies: the
 * capture script's client grew a timeout because a lost reply hung a run
 * forever, and a second copy without it would hang the same way.
 */

export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      for (const handler of this.handlers.get(message.method) ?? []) {
        handler(message.params, message.sessionId);
      }
    });
    /*
     * A closed socket has to fail the commands that are still waiting on it.
     * Without this, a browser that goes away — crashed, killed, or simply
     * unreachable — leaves every pending promise unsettled, and the script
     * waits on them forever with no output at all. The failure then looks
     * exactly like "still working".
     */
    socket.addEventListener('close', () => {
      this.failPending(new Error('the DevTools connection closed'));
    });
    socket.addEventListener('error', () => {
      this.failPending(new Error('the DevTools connection failed'));
    });
  }

  failPending(error) {
    for (const [, entry] of this.pending) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener(
        'error',
        () => {
          reject(new Error(`cannot connect to ${url}`));
        },
        { once: true }
      );
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    /*
     * Every command is bounded. Without a timeout a lost reply hangs the
     * script forever, and "forever" with no output is indistinguishable from
     * "still working" — that is how a capture run silently stalls after
     * printing the last thing the user can act on. The screencast frame
     * handler is the one call that legitimately waits longer.
     */
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: result => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
        method,
      });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // 已经关掉了就算了。
    }
  }
}

/**
 * Attach to a target and return its session id.
 *
 * The session is not usable the instant it is attached — the execution
 * context may not exist yet — so this is where a caller that needs `chrome.*`
 * in the page should start polling.
 */
export async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  return sessionId;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
