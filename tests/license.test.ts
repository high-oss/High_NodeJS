// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every hand-written source file. `generated/` is excluded — the generator owns it. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const relative = `${dir}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.(ts|mjs|js)$/.test(entry) ? [relative] : [];
  });
}

describe('licence headers', () => {
  it('every hand-written source file carries the SPDX header', () => {
    const files = ['src', 'tests', 'scripts', 'examples'].flatMap((dir) => sourceFiles(dir));
    expect(files.length).toBeGreaterThan(0);

    const missing = files.filter((file) => {
      const head = readFileSync(join(root, file), 'utf8').slice(0, 200);
      return !head.includes('SPDX-License-Identifier: MIT')
        || !head.includes('Copyright (c) 2026 Truestock');
    });

    expect(missing, `missing licence header:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the LICENSE file is MIT and names the copyright holder', () => {
    const licence = readFileSync(join(root, 'LICENSE'), 'utf8');
    expect(licence).toContain('MIT License');
    expect(licence).toContain('Copyright (c) 2026 Truestock');
    expect(licence).toContain('WITHOUT WARRANTY OF ANY KIND');
  });

  it('package.json declares the same licence', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.license).toBe('MIT');
  });
});
