// @vitest-environment node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../docs/.vitepress/config';

describe('documentation site', () => {
  it('uses the GitHub Pages project base and local search', () => {
    expect(config.base).toBe('/idb-activerecord/');
    expect(config.themeConfig?.search?.provider).toBe('local');
  });

  it('has a page for every navigation and sidebar link', () => {
    const links = [
      ...config.themeConfig!.nav!.map(item => item.link),
      ...config.themeConfig!.sidebar!.flatMap(section =>
        section.items ? section.items.map(item => item.link) : [section.link]
      )
    ];
    for (const link of links) {
      expect(link).toBeTruthy();
      expect(existsSync(resolve('docs', `.${link}.md`)), link).toBe(true);
    }
  });
});
