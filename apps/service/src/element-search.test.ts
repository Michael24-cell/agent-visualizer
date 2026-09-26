import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  describeSelectorSources,
  findSelectorSources,
  selectorTokens,
} from './element-search.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function site(): string {
  const root = mkdtempSync(join(tmpdir(), 'element-search-'));
  folders.push(root);
  mkdirSync(join(root, 'styles'));
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<header class="hero">\n  <p class="tag">offline-first</p>\n</header>\n',
  );
  writeFileSync(
    join(root, 'styles', 'site.css'),
    'body { margin: 0 }\n.tag {\n  color: #888;\n}\n#banner { display: none }\n',
  );
  writeFileSync(join(root, 'notes.txt'), '.tag is not searched here\n');
  writeFileSync(
    join(root, 'node_modules', 'junk', 'a.css'),
    '.tag { color: red }\n',
  );
  return root;
}

describe('selectorTokens', () => {
  it('prefers ids and classes, falls back to distinctive tags', () => {
    expect(selectorTokens('header > p.tag')).toEqual(['.tag']);
    expect(selectorTokens('#banner .row:nth-of-type(2)')).toEqual([
      '#banner',
      '.row',
    ]);
    expect(selectorTokens('main > section')).toEqual(['main', 'section']);
    expect(selectorTokens('div > span')).toEqual([]);
  });
});

describe('findSelectorSources', () => {
  it('finds the markup and the stylesheet, skipping vendor folders and unsearchable files', () => {
    const root = site();
    const hits = findSelectorSources(root, 'header > p.tag');
    expect(hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([
      'index.html:2',
      'styles/site.css:2',
    ]);
    expect(hits[1]!.text).toBe('.tag {');
    expect(findSelectorSources(root, '#banner')).toMatchObject([
      { path: 'styles/site.css', line: 5 },
    ]);
    expect(findSelectorSources(root, 'div > span')).toEqual([]);
  });

  it('describes the hits for the agent, or says nothing', () => {
    const root = site();
    const text = describeSelectorSources(findSelectorSources(root, '.tag'));
    expect(text).toContain('Where .tag appear:');
    expect(text).toContain('- index.html:2 —');
    expect(describeSelectorSources([])).toBe('');
  });
});
