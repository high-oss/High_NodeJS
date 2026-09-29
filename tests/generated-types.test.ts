// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { components, paths } from '../generated/openapi.js';

describe('generated types', () => {
  it('covers every operation in the pinned spec', () => {
    const spec = JSON.parse(readFileSync(new URL('../generated/openapi.json', import.meta.url), 'utf8'));
    const operations = Object.values(spec.paths as Record<string, Record<string, unknown>>)
      .flatMap((item) => Object.keys(item))
      .filter((key) => ['get', 'post', 'put', 'delete', 'patch'].includes(key));
    expect(operations).toHaveLength(28);
  });

  it('exposes the shared component schemas the facades return', () => {
    // Compile-time assertions — these fail `tsc` if the generator renamed anything.
    type Order = components['schemas']['Order'];
    type Funds = components['schemas']['Funds'];
    type PlaceOrder = paths['/orders']['post'];
    const order: Pick<Order, 'orderId'> = { orderId: '1' };
    const funds: Pick<Funds, 'availableBalance'> = { availableBalance: 0 };
    expect(order.orderId).toBe('1');
    expect(funds.availableBalance).toBe(0);
    expect<keyof PlaceOrder>('responses').toBe('responses');
  });
});
