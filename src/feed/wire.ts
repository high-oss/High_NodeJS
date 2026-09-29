// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { FeedKind } from './models.js';

/**
 * Internal wire shapes and constants for the datafeed's JSON protocol. None
 * of this is exported from the package's public surface — callers subscribe
 * by HIGH scrip key and never see a feed segment, a frame's `name`, or a
 * channel number.
 */

/** Subscribe-request type prefix per kind, per the datafeed-socket plan. */
export const KIND_PREFIX: Readonly<Record<FeedKind, string>> = {
  quote: 'mw',
  depth: 'dp',
  index: 'if',
};

/** Fixed channel numbers, one per kind. Pausing/resuming/lite-vs-full channel control is not exposed. */
export const KIND_CHANNEL: Readonly<Record<FeedKind, number>> = {
  quote: 1,
  depth: 2,
  index: 3,
};

/** The `name` a tick element carries, routing it to quote, depth or index handling. */
export const TICK_FRAME_NAME: Readonly<Record<FeedKind, string>> = {
  quote: 'sf',
  depth: 'dp',
  index: 'if',
};

export interface AuthFrame {
  readonly type: 'cn';
  readonly sessionid: string;
}

export interface AuthAckOk {
  readonly type: 'cn';
  readonly stat: 'Ok';
  readonly msg: string;
  readonly stCode: number;
  readonly maxScripPerConn: number;
  readonly maxScripPerReq: number;
  readonly sType?: string;
}

export interface AuthAckNotOk {
  readonly type: 'cn';
  readonly stat: 'NotOk';
  readonly msg: string;
  readonly stCode: number;
}

export function isAuthAck(value: Record<string, unknown>): boolean {
  return value['type'] === 'cn' && typeof value['stat'] === 'string';
}

export interface SubUnsubAck {
  readonly type: 'sub' | 'unsub';
  readonly stat: 'Ok' | 'NotOk';
  readonly msg: string;
  readonly stCode: number;
}

export function isSubUnsubAck(value: Record<string, unknown>): boolean {
  return (value['type'] === 'sub' || value['type'] === 'unsub') && typeof value['stat'] === 'string';
}

/** A subscribe/unsubscribe/snapshot request frame. */
export interface SubUnsubFrame {
  readonly type: string;
  readonly scrips: string;
  readonly channelnum?: number;
}
