/**
 * ISOLATED <-> MAIN world handshake bridge.
 *
 * The MAIN-world scriptlet has no access to chrome.* APIs, so it depends on the
 * ISOLATED-world content script to forward the spoof config over the page's
 * `window` via CustomEvents. Both scripts run at `document_start`, so their
 * relative load order is not guaranteed.
 *
 * To make the handshake order-independent we use a request/response pattern:
 *
 *   - ISOLATED (the "server") eagerly pushes the config once, AND answers any
 *     `REQUEST_EVENT` it receives by (re)dispatching the current config.
 *   - MAIN (the "client") listens for the config, AND on init fires a
 *     `REQUEST_EVENT` so that if ISOLATED was already up (and its eager push
 *     was missed) it gets the config anyway.
 *
 * This covers both orderings:
 *   - ISOLATED-first: MAIN's listener catches the eager push (or its request is
 *     answered — both are harmless thanks to idempotency).
 *   - MAIN-first: MAIN's request arrives after ISOLATED's listener is wired, so
 *     ISOLATED responds with the config.
 *
 * All payload handling is idempotent: receiving the config any number of times
 * simply re-applies the latest value.
 */

/** Event carrying the spoof config from ISOLATED -> MAIN. */
export const CONFIG_EVENT = 'sch:config';
/** Event asking ISOLATED to (re)send the config, dispatched by MAIN. */
export const REQUEST_EVENT = 'sch:request-config';

/** Shape of the config payload carried across the world boundary. */
export interface SpoofConfig {
  spoofAntiAdblock: boolean;
}

type EventTargetLike = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>;

function isSpoofConfig(detail: unknown): detail is SpoofConfig {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as { spoofAntiAdblock?: unknown }).spoofAntiAdblock ===
      'boolean'
  );
}

/**
 * ISOLATED side. Eagerly dispatches the current config once and registers a
 * listener that re-dispatches it whenever MAIN asks. `getConfig` is a callback
 * so the latest value is always sent, even if it changes between requests.
 *
 * Returns a disposer that removes the request listener.
 */
export function serveSpoofConfig(
  win: EventTargetLike,
  getConfig: () => SpoofConfig,
): () => void {
  const dispatchConfig = (): void => {
    win.dispatchEvent(
      new CustomEvent<SpoofConfig>(CONFIG_EVENT, { detail: getConfig() }),
    );
  };

  const onRequest = (): void => dispatchConfig();
  win.addEventListener(REQUEST_EVENT, onRequest);

  // Eager push for the ISOLATED-first ordering.
  dispatchConfig();

  return () => win.removeEventListener(REQUEST_EVENT, onRequest);
}

/**
 * MAIN side. Listens for config events (idempotently invoking `onConfig` each
 * time) and immediately fires a request so an already-initialized ISOLATED
 * world responds. Covers the MAIN-first ordering.
 *
 * Returns a disposer that removes the config listener.
 */
export function requestSpoofConfig(
  win: EventTargetLike,
  onConfig: (config: SpoofConfig) => void,
): () => void {
  const onConfigEvent = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    if (isSpoofConfig(detail)) {
      onConfig(detail);
    }
  };
  win.addEventListener(CONFIG_EVENT, onConfigEvent);

  // Ask the ISOLATED world to (re)send in case its eager push already fired.
  win.dispatchEvent(new CustomEvent(REQUEST_EVENT));

  return () => win.removeEventListener(CONFIG_EVENT, onConfigEvent);
}
