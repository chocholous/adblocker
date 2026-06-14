import { describe, it, expect, vi } from 'vitest';
import {
  serveSpoofConfig,
  requestSpoofConfig,
  CONFIG_EVENT,
  REQUEST_EVENT,
  type SpoofConfig,
} from '../lib/bridge';

/**
 * The handshake runs entirely over `window` CustomEvents. We give each test its
 * own `EventTarget` (typed as Window for the bridge API) so listeners never leak
 * between tests — that lets us simulate both script-load orderings
 * deterministically by choosing the order in which we call serve/request.
 */
function makeBus(): Window {
  return new EventTarget() as unknown as Window;
}

describe('ISOLATED <-> MAIN spoof config handshake', () => {
  it('ISOLATED-first: MAIN receives config via the request/response path', () => {
    const bus = makeBus();
    const received: SpoofConfig[] = [];

    // ISOLATED initializes first and eagerly pushes (no listener yet).
    serveSpoofConfig(bus, () => ({ spoofAntiAdblock: false }));
    // MAIN comes up later: it listens and fires a request, which ISOLATED
    // answers, so the missed eager push doesn't matter.
    requestSpoofConfig(bus, (c) => received.push(c));

    expect(received).toEqual([{ spoofAntiAdblock: false }]);
  });

  it('MAIN-first: MAIN receives config once ISOLATED answers/pushes', () => {
    const bus = makeBus();
    const received: SpoofConfig[] = [];

    // MAIN initializes first: listens and fires a request into the void.
    requestSpoofConfig(bus, (c) => received.push(c));
    expect(received).toEqual([]); // nobody answered yet

    // ISOLATED comes up later. Its eager push reaches MAIN's live listener.
    serveSpoofConfig(bus, () => ({ spoofAntiAdblock: true }));

    expect(received).toEqual([{ spoofAntiAdblock: true }]);
  });

  it('serves the latest config each time MAIN re-requests', () => {
    const bus = makeBus();
    const received: SpoofConfig[] = [];
    let current: SpoofConfig = { spoofAntiAdblock: true };

    serveSpoofConfig(bus, () => current); // eager push #1 -> no listener yet
    requestSpoofConfig(bus, (c) => received.push(c)); // gets current value

    current = { spoofAntiAdblock: false };
    // Simulate MAIN asking again later (e.g. after a settings change).
    bus.dispatchEvent(new CustomEvent(REQUEST_EVENT));

    expect(received).toEqual([
      { spoofAntiAdblock: true },
      { spoofAntiAdblock: false },
    ]);
  });

  it('handling is idempotent: duplicate config events re-apply safely', () => {
    const bus = makeBus();
    const onConfig = vi.fn();
    requestSpoofConfig(bus, onConfig);
    serveSpoofConfig(bus, () => ({ spoofAntiAdblock: true }));

    // Fire several more config events directly.
    for (let i = 0; i < 3; i++) {
      bus.dispatchEvent(
        new CustomEvent<SpoofConfig>(CONFIG_EVENT, {
          detail: { spoofAntiAdblock: true },
        }),
      );
    }

    // Every event invoked the handler with the same value; no throws.
    expect(onConfig).toHaveBeenCalledTimes(4);
    expect(onConfig).toHaveBeenLastCalledWith({ spoofAntiAdblock: true });
  });

  it('ignores malformed config payloads', () => {
    const bus = makeBus();
    const onConfig = vi.fn();
    requestSpoofConfig(bus, onConfig);

    bus.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: null }));
    bus.dispatchEvent(
      new CustomEvent(CONFIG_EVENT, { detail: { spoofAntiAdblock: 'yes' } }),
    );

    expect(onConfig).not.toHaveBeenCalled();
  });

  it('disposers detach listeners', () => {
    const bus = makeBus();
    const onConfig = vi.fn();
    const disposeRequest = requestSpoofConfig(bus, onConfig);
    const disposeServe = serveSpoofConfig(bus, () => ({
      spoofAntiAdblock: true,
    }));

    // The handshake so far: MAIN's request was answered by ISOLATED's listener,
    // and ISOLATED's eager push reached MAIN's listener -> two deliveries.
    const callsBeforeDispose = onConfig.mock.calls.length;
    expect(callsBeforeDispose).toBeGreaterThan(0);

    disposeRequest();
    disposeServe();

    // After disposal, neither a new request nor a config event is handled.
    bus.dispatchEvent(new CustomEvent(REQUEST_EVENT));
    bus.dispatchEvent(
      new CustomEvent<SpoofConfig>(CONFIG_EVENT, {
        detail: { spoofAntiAdblock: false },
      }),
    );

    expect(onConfig).toHaveBeenCalledTimes(callsBeforeDispose);
  });
});
