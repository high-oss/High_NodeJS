// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Regenerates generated/openapi.d.ts from the canonical spec at the commit
 * pinned in spec.lock.json. Generated output is committed, so consumers of this
 * repo never run the generator.
 *
 * To move to a newer spec: update spec.lock.json, run this, commit both.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(resolve(here, '../spec.lock.json'), 'utf8'));
const specRepo = resolve(here, '..', lock.repo);

// Read the spec AT THE PINNED COMMIT, not from the working tree — a dirty spec
// checkout must never leak into generated types.
const spec = execFileSync('git', ['-C', specRepo, 'show', `${lock.commit}:${lock.file}`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const specPath = resolve(here, '../generated/openapi.json');
mkdirSync(dirname(specPath), { recursive: true });
writeFileSync(specPath, spec, 'utf8');

// Run the generator's own JS entry with this Node binary rather than going
// through npx: Node 24 on Windows refuses to spawn a .cmd shim (EINVAL, the
// CVE-2024-27980 hardening), and `shell: true` would work but reintroduces the
// injection surface that hardening exists to close.
const cli = resolve(here, '../node_modules/openapi-typescript/bin/cli.js');

execFileSync(
  process.execPath,
  [cli, specPath, '-o', resolve(here, '../generated/openapi.d.ts')],
  { stdio: 'inherit' },
);

console.log(`Generated from spec commit ${lock.commit.slice(0, 7)}.`);
