// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

import { type HighClientOptions, resolveConfig, type ResolvedConfig } from '../config.js';
import { classifyAuthFailure, HighFeedAuthError, HighFeedError } from './errors.js';
import { type FeedIdentity, feedTopicOf, translateScripKey } from './key-translation.js';
import {
  buildDepth,
  buildIndexTick,
  buildQuote,
  buildTopOfBookDepth,
  changedWireKeys,
  type FeedKind,
  type FeedTickEvent,
  mergeRaw,
  type RawTick,
} from './models.js';
import { AsyncQueue } from './async-queue.js';
import {
  type AuthAckNotOk,
  type AuthAckOk,
  isAuthAck,
  isSubUnsubAck,
  KIND_CHANNEL,
  KIND_PREFIX,
  type SubUnsubAck,
  type SubUnsubFrame,
} from './wire.js';

export type {
  Depth,
  DepthLevel,
  DepthTickEvent,
  FeedKind,
  FeedTickEvent,
  IndexTick,
  IndexTickEvent,
  Quote,
  QuoteTickEvent,
} from './models.js';
export { HighFeedAuthError, HighFeedError } from './errors.js';
export type { FeedAuthFailureReason } from './errors.js';

type FeedState = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting' | 'closed' | 'failed';

interface Limits {
  readonly maxScripPerConn: number;
  readonly maxScripPerReq: number;
}

/** What each event on `HighFeed` carries, for `on`/`once`/`off`. */
export interface HighFeedEventMap {
  connected: [];
  disconnected: [detail: { code?: number; reason?: string }];
  reconnecting: [detail: { attempt: number; delayMs: number }];
  error: [error: Error];
  quote: [event: Extract<FeedTickEvent, { kind: 'quote' }>];
  depth: [event: Extract<FeedTickEvent, { kind: 'depth' }>];
  index: [event: Extract<FeedTickEvent, { kind: 'index' }>];
}

// A closed socket, dead but never reconnected, is worse than one that keeps
// trying: this is the backoff schedule for transport failures only — an auth
// rejection never reaches this path (see the plan's "auth is a gate" rule).
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;

// A dead-but-open socket delivers nothing and closes nothing on its own.
// Any inbound frame — tick, ack, anything — resets this timer; its expiry is
// treated as a transport failure and folds into the same reconnect path.
const IDLE_TIMEOUT_MS = 45_000;

function dedupe(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function frameText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

/**
 * HIGH's live datafeed — a separate client beside {@link HighClient}, built
 * from the same options and credentials. Production only: there is no
 * sandbox feed, so a client configured for one refuses construction outright.
 *
 * Subscribe by HIGH scrip key. The feed's own segment codes, tokens and
 * channel numbers never appear on this surface.
 *
 * Delivery is both an event emitter (`on('quote', …)`, `on('depth', …)`,
 * `on('index', …)`) and an async iterable over every tick regardless of kind:
 *
 * ```ts
 * const feed = new HighFeed({ accessToken });
 * await feed.connect();
 * await feed.subscribeQuotes(['NSE@2885']);
 * for await (const tick of feed) {
 *   if (tick.kind === 'quote') console.log(tick.data.lastTradedPrice);
 * }
 * ```
 */
export class HighFeed extends EventEmitter {
  private readonly config: ResolvedConfig;
  private readonly queue = new AsyncQueue<FeedTickEvent>();

  private readonly subscriptions: Record<FeedKind, Set<string>> = {
    quote: new Set(),
    depth: new Set(),
    index: new Set(),
  };
  private readonly identities = new Map<string, FeedIdentity>();
  private readonly topicToScripKey = new Map<string, string>();
  private readonly rawState = new Map<string, RawTick>();

  private ws?: WebSocket;
  private state: FeedState = 'idle';
  private limits?: Limits;
  private connectPromise?: Promise<void>;
  private opQueue: Promise<unknown> = Promise.resolve();

  private pendingAuthAck?: {
    resolve: (ack: AuthAckOk | AuthAckNotOk) => void;
    reject: (err: unknown) => void;
  };
  private pendingSubAck?: { resolve: (ack: SubUnsubAck) => void; reject: (err: unknown) => void };

  private idleTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  /** Set once a `cn` ack comes back NotOk; latched until the next successful auth. Suppresses auto-reconnect. */
  private authFailed = false;

  constructor(options: HighClientOptions = {}) {
    super();
    const config = resolveConfig(options);
    if (config.environment !== 'production') {
      throw new HighFeedError(
        `HighFeed is production-only — there is no sandbox datafeed. This client was configured for ` +
          `"${config.environment}"; construct it with environment: "production" (the default) instead.`,
      );
    }
    this.config = config;
  }

  /**
   * Opens the socket, sends the auth frame, and waits for its acknowledgement
   * before returning. Idempotent while a connection attempt is in flight.
   */
  async connect(): Promise<void> {
    if (this.state === 'closed') {
      throw new HighFeedError('This HighFeed has been closed. Construct a new one to reconnect.');
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.openAndAuthenticate()
      .then(() => {
        this.emit('connected');
      })
      .catch((err: unknown) => {
        this.connectPromise = undefined;
        throw err;
      });
    return this.connectPromise;
  }

  // -- Subscriptions, one pair (plus snapshot) per kind ----------------------
  // Indices are subscribed deliberately, not as a side effect of an argument:
  // `subscribeQuotes`/`subscribeDepth` reject an index key outright, pointing
  // the caller at `subscribeIndices` instead of silently accepting a key that
  // would never tick under the wrong channel — see `assertKindMatchesIndex`.

  /** Subscribes to quotes for `scripKeys`. Splits across requests to honour `maxScripPerReq`. */
  subscribeQuotes(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSubscribe(scripKeys, 'quote'));
  }

  unsubscribeQuotes(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doUnsubscribe(scripKeys, 'quote'));
  }

  /** Requests an immediate quote refresh for already-subscribed keys, delivered like any other tick. */
  snapshotQuotes(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSnapshot(scripKeys, 'quote'));
  }

  /** Subscribes to the five-level book for `scripKeys`. Splits across requests to honour `maxScripPerReq`. */
  subscribeDepth(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSubscribe(scripKeys, 'depth'));
  }

  unsubscribeDepth(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doUnsubscribe(scripKeys, 'depth'));
  }

  /** Requests an immediate depth refresh for already-subscribed keys, delivered like any other tick. */
  snapshotDepth(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSnapshot(scripKeys, 'depth'));
  }

  /** Subscribes to `scripKeys` as indices. Every key must be one of the committed index keys. */
  subscribeIndices(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSubscribe(scripKeys, 'index'));
  }

  unsubscribeIndices(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doUnsubscribe(scripKeys, 'index'));
  }

  /** Requests an immediate index refresh for already-subscribed keys, delivered like any other tick. */
  snapshotIndices(scripKeys: readonly string[]): Promise<void> {
    return this.enqueue(() => this.doSnapshot(scripKeys, 'index'));
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.clearIdleTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.queue.end();

    const ws = this.ws;
    this.ws = undefined;
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<FeedTickEvent> {
    return this.queue[Symbol.asyncIterator]();
  }

  override on<K extends keyof HighFeedEventMap>(
    event: K,
    listener: (...args: HighFeedEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof HighFeedEventMap>(
    event: K,
    listener: (...args: HighFeedEventMap[K]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof HighFeedEventMap>(
    event: K,
    listener: (...args: HighFeedEventMap[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  // -- Sequenced operations --------------------------------------------------
  // subscribe/unsubscribe/snapshot run one at a time, in call order, so a sub
  // ack can never be matched against the wrong request.

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.opQueue.then(fn, fn);
    this.opQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async doSubscribe(scripKeys: readonly string[], kind: FeedKind): Promise<void> {
    this.assertConnected();
    const unique = dedupe(scripKeys);
    if (unique.length === 0) return;

    for (const key of unique) {
      const identity = translateScripKey(key);
      this.assertKindMatchesIndex(key, kind, identity.isIndex);
      this.identities.set(key, identity);
    }

    const newKeys = unique.filter((key) => !this.subscriptions[kind].has(key));
    if (newKeys.length === 0) return;

    this.assertWithinConnLimit(newKeys.length);
    await this.sendSubscribeFrames(newKeys, kind);

    for (const key of newKeys) {
      this.subscriptions[kind].add(key);
      this.topicToScripKey.set(feedTopicOf(this.identities.get(key)!), key);
    }
  }

  private async doUnsubscribe(scripKeys: readonly string[], kind: FeedKind): Promise<void> {
    this.assertConnected();
    const unique = dedupe(scripKeys).filter((key) => this.subscriptions[kind].has(key));
    if (unique.length === 0) return;

    const limits = this.requireLimits();
    for (const keyChunk of chunk(unique, limits.maxScripPerReq)) {
      const topics = keyChunk.map((key) => feedTopicOf(this.identities.get(key)!));
      await this.sendAndAwaitSubUnsubAck(
        { type: `${KIND_PREFIX[kind]}u`, scrips: topics.join('&'), channelnum: KIND_CHANNEL[kind] },
        'unsub',
      );
    }

    for (const key of unique) {
      this.subscriptions[kind].delete(key);
      const stillNeeded = (['quote', 'depth', 'index'] as const).some((k) => this.subscriptions[k].has(key));
      if (!stillNeeded) {
        const identity = this.identities.get(key);
        if (identity) this.topicToScripKey.delete(feedTopicOf(identity));
        this.rawState.delete(`sf:${key}`);
        this.rawState.delete(`dp:${key}`);
        this.rawState.delete(`if:${key}`);
      }
    }
  }

  private async doSnapshot(scripKeys: readonly string[], kind: FeedKind): Promise<void> {
    this.assertConnected();
    const unique = dedupe(scripKeys);
    for (const key of unique) {
      if (!this.subscriptions[kind].has(key)) {
        throw new HighFeedError(
          `Cannot request a snapshot for "${key}" under kind "${kind}" — subscribe to it first.`,
        );
      }
    }
    if (unique.length === 0) return;

    const limits = this.requireLimits();
    for (const keyChunk of chunk(unique, limits.maxScripPerReq)) {
      const topics = keyChunk.map((key) => feedTopicOf(this.identities.get(key)!));
      // The vendor sample's own snapshot request carries no channelnum and
      // gets no dedicated acknowledgement — the refresh simply arrives as an
      // ordinary tick frame, merged and delivered like any other.
      this.sendRaw({ type: `${KIND_PREFIX[kind]}sp`, scrips: topics.join('&') });
    }
  }

  private async sendSubscribeFrames(keys: readonly string[], kind: FeedKind): Promise<void> {
    const limits = this.requireLimits();
    for (const keyChunk of chunk(keys, limits.maxScripPerReq)) {
      const topics = keyChunk.map((key) => feedTopicOf(this.identities.get(key)!));
      await this.sendAndAwaitSubUnsubAck(
        { type: `${KIND_PREFIX[kind]}s`, scrips: topics.join('&'), channelnum: KIND_CHANNEL[kind] },
        'sub',
      );
    }
  }

  private sendAndAwaitSubUnsubAck(frame: SubUnsubFrame, expected: 'sub' | 'unsub'): Promise<SubUnsubAck> {
    return new Promise<SubUnsubAck>((resolve, reject) => {
      this.pendingSubAck = { resolve, reject };
      try {
        this.sendRaw(frame);
      } catch (err) {
        this.pendingSubAck = undefined;
        reject(err);
      }
    }).then((ack) => {
      if (ack.stat !== 'Ok') {
        throw new HighFeedError(
          `HIGH datafeed ${expected} request was refused (stCode ${ack.stCode}): ${ack.msg}`,
        );
      }
      return ack;
    });
  }

  // -- Connection lifecycle ---------------------------------------------------

  private async openAndAuthenticate(): Promise<void> {
    if (!this.config.accessToken) {
      throw new HighFeedError('HighFeed needs an accessToken. Pass it to the client, or set HIGH_ACCESS_TOKEN.');
    }

    this.state = 'connecting';
    const ws = new WebSocket(this.config.wsBaseUrl);
    this.ws = ws;

    this.config.logger.info(`HIGH feed -> connecting ${this.config.wsBaseUrl}`);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(new HighFeedError(`Failed to open the datafeed socket: ${err.message}`));
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };
      ws.on('open', onOpen);
      ws.on('error', onError);
    });

    ws.on('message', (data: unknown) => this.handleMessage(frameText(data)));
    ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason.toString('utf8')));
    ws.on('error', (err: Error) => {
      this.config.logger.error('HIGH feed socket error', err.message);
      this.safeEmitError(err);
    });

    this.state = 'authenticating';

    // The auth frame goes first, and nothing else is sent until its
    // acknowledgement arrives — no subscription may be queued ahead of it.
    // `mode` is deliberately absent: it follows the customer's data plan and
    // is filled in server-side. Never logged — it carries the access token.
    const ack = await new Promise<AuthAckOk | AuthAckNotOk>((resolve, reject) => {
      this.pendingAuthAck = { resolve, reject };
      try {
        this.sendRaw({ type: 'cn', sessionid: this.config.accessToken });
      } catch (err) {
        this.pendingAuthAck = undefined;
        reject(err);
      }
    });

    if (ack.stat !== 'Ok') {
      const reason = classifyAuthFailure(ack.stCode, ack.msg);
      this.authFailed = true;
      this.state = 'failed';
      ws.close();
      throw new HighFeedAuthError({ stCode: ack.stCode, msg: ack.msg, reason });
    }

    this.authFailed = false;
    this.limits = { maxScripPerConn: ack.maxScripPerConn, maxScripPerReq: ack.maxScripPerReq };
    this.state = 'connected';
    this.resetIdleTimer();
  }

  private handleClose(code: number, reason: string): void {
    this.clearIdleTimer();
    this.ws = undefined;
    // A deliberate close(), or a close that followed an auth rejection we
    // already surfaced, must never trigger the automatic reconnect loop — the
    // server told us, in-band, that it will keep refusing.
    if (this.state === 'closed' || this.authFailed) return;
    this.emit('disconnected', { code, reason });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.state = 'reconnecting';
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { attempt: this.reconnectAttempt, delayMs: delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.runReconnectAttempt();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private runReconnectAttempt(): void {
    this.openAndAuthenticate()
      .then(() => this.resubscribeAll())
      .then(() => {
        this.reconnectAttempt = 0;
        this.emit('connected');
      })
      .catch((err: unknown) => {
        if (err instanceof HighFeedAuthError) {
          // Never retried or reconnected — the server will keep refusing. This
          // is the one reconnect-path failure a caller truly needs to know
          // about, so it always reaches "error" (safely — see safeEmitError).
          this.safeEmitError(err);
          return;
        }
        // A single failed reconnect attempt is expected, self-healing
        // behaviour, not something that should be capable of crashing a host
        // process that never attached an "error" listener (Node's
        // EventEmitter throws on an unheard "error"). Log it and try again.
        this.config.logger.warn(
          `HIGH feed reconnect attempt failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (this.state !== 'closed') this.scheduleReconnect();
      });
  }

  private async resubscribeAll(): Promise<void> {
    for (const kind of ['quote', 'depth', 'index'] as const) {
      const keys = [...this.subscriptions[kind]];
      if (keys.length > 0) await this.sendSubscribeFrames(keys, kind);
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.config.logger.warn(
        `HIGH feed <- no messages for ${IDLE_TIMEOUT_MS}ms; treating the connection as stale`,
      );
      this.ws?.terminate();
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // -- Message handling ---------------------------------------------------

  private sendRaw(frame: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new HighFeedError('The HIGH datafeed socket is not open.');
    }
    this.ws.send(JSON.stringify(frame));
  }

  private handleMessage(raw: string): void {
    this.resetIdleTimer();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.config.logger.warn('HIGH feed <- received a non-JSON frame; ignoring it');
      return;
    }

    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;

      if (isAuthAck(record)) {
        const pending = this.pendingAuthAck;
        this.pendingAuthAck = undefined;
        pending?.resolve(record as unknown as AuthAckOk | AuthAckNotOk);
        continue;
      }
      if (isSubUnsubAck(record)) {
        const pending = this.pendingSubAck;
        this.pendingSubAck = undefined;
        pending?.resolve(record as unknown as SubUnsubAck);
        continue;
      }

      const name = record['name'];
      if (name === 'sf' || name === 'dp' || name === 'if') {
        this.handleTick(record, name);
        continue;
      }
      this.config.logger.debug('HIGH feed <- unrecognised frame', record);
    }
  }

  private handleTick(record: Record<string, unknown>, name: 'sf' | 'dp' | 'if'): void {
    const e = record['e'];
    const tk = record['tk'];
    if (typeof e !== 'string' || (typeof tk !== 'string' && typeof tk !== 'number')) return;

    const topic = `${e}|${tk}`;
    const scripKey = this.topicToScripKey.get(topic);
    if (!scripKey) return; // A tick for something we no longer track — never crash on it.

    const bucketKey = `${name}:${scripKey}`;
    const raw = record as RawTick;
    const merged = mergeRaw(this.rawState.get(bucketKey), raw);
    this.rawState.set(bucketKey, merged);
    const changed = changedWireKeys(raw);

    if (name === 'sf') {
      const quoteResult = buildQuote(scripKey, merged, changed);
      if (quoteResult) {
        this.emitTick({ kind: 'quote', scripKey, data: quoteResult.quote, changedFields: quoteResult.changedFields });
      }
      const depthResult = buildTopOfBookDepth(scripKey, merged, changed);
      if (depthResult) {
        this.emitTick({ kind: 'depth', scripKey, data: depthResult.depth, changedFields: depthResult.changedFields });
      }
    } else if (name === 'dp') {
      const { depth, changedFields } = buildDepth(scripKey, merged, changed);
      this.emitTick({ kind: 'depth', scripKey, data: depth, changedFields });
    } else {
      const { indexTick, changedFields } = buildIndexTick(scripKey, merged, changed);
      this.emitTick({ kind: 'index', scripKey, data: indexTick, changedFields });
    }
  }

  private emitTick(event: FeedTickEvent): void {
    this.emit(event.kind, event);
    this.queue.push(event);
  }

  /**
   * Node's `EventEmitter` throws synchronously when `"error"` is emitted with
   * no listener attached — appropriate for a programming mistake, wrong for a
   * datafeed telling a caller who chose the async-iterator style (and so
   * never attached one) about a socket-level failure. Emits normally when
   * someone is listening; otherwise logs at `error` level instead of crashing
   * the host process.
   */
  private safeEmitError(err: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    } else {
      this.config.logger.error('HIGH feed error (no "error" listener attached)', err.message);
    }
  }

  // -- Guards ---------------------------------------------------------------

  private assertConnected(): void {
    if (this.state !== 'connected') {
      throw new HighFeedError(`HighFeed is not connected (state: "${this.state}"). Call connect() first.`);
    }
  }

  private requireLimits(): Limits {
    if (!this.limits) throw new HighFeedError('HighFeed has not completed authentication yet.');
    return this.limits;
  }

  private assertWithinConnLimit(additional: number): void {
    const limits = this.requireLimits();
    const current =
      this.subscriptions.quote.size + this.subscriptions.depth.size + this.subscriptions.index.size;
    if (current + additional > limits.maxScripPerConn) {
      throw new HighFeedError(
        `Subscribing to ${additional} more scrip(s) would exceed maxScripPerConn ` +
          `(${limits.maxScripPerConn}); ${current} already subscribed.`,
      );
    }
  }

  private assertKindMatchesIndex(scripKey: string, kind: FeedKind, isIndex: boolean): void {
    if (isIndex && kind !== 'index') {
      throw new HighFeedError(
        `"${scripKey}" is one of the committed index keys — subscribe to it with kind: "index", not ` +
          `"${kind}". Indices are not published under the touchline or depth channels.`,
      );
    }
    if (!isIndex && kind === 'index') {
      throw new HighFeedError(
        `"${scripKey}" is not one of the committed index keys, so it cannot be subscribed with kind: "index".`,
      );
    }
  }
}
