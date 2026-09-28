// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Interpolates a path template, percent-encoding every value.
 *
 * Trading symbols legitimately contain `&` and spaces (`M&M-EQ`, `NIFTY 50`),
 * which change the request if interpolated raw. Encoding is not optional.
 */
export function pathOf(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}
