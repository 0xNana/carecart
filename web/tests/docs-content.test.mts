import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const content = join(root, 'docs');
test('public docs navigation and links resolve from the root MDX collection', () => {
  const pages = new Set(readdirSync(content).filter(name => name.endsWith('.mdx')).map(name => name.slice(0, -4)));
  const meta = JSON.parse(readFileSync(join(content, 'meta.json'), 'utf8'));
  for (const page of meta.pages) {
    if (!page.startsWith('---')) assert.ok(pages.has(page), 'Missing navigation page: ' + page);
  }
  for (const page of pages) {
    const source = readFileSync(join(content, page + '.mdx'), 'utf8');
    assert.match(source, /^---\ntitle: .+\ndescription: .+\n---/);
    for (const link of source.matchAll(/(?:\]\(|href=")\/docs\/([a-z-]+)/g)) {
      assert.ok(pages.has(link[1]), 'Broken docs link in ' + page + ': ' + link[1]);
    }
  }
  assert.ok(existsSync(join(root, 'JUDGE_WALKTHROUGH.md')));
  assert.ok(existsSync(join(root, 'evidence/testnet/autonomous-payment.json')));
  assert.ok(!existsSync(join(content, 'evidence')));
  assert.ok(!existsSync(join(content, 'FINAL_HACKATHON_HANDOFF.md')));
});
