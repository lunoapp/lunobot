import { describe, expect, it } from 'vitest';

import { normalizeTelegramOutbound } from './telegram-normalize.js';

describe('normalizeTelegramOutbound', () => {
  describe('em-dash → en-dash', () => {
    it('rewrites spaced and multiple em-dashes', () => {
      expect(normalizeTelegramOutbound('a — b — c')).toBe('a – b – c');
    });
    it('leaves en-dashes and hyphens alone', () => {
      expect(normalizeTelegramOutbound('10–20 Uhr, E-Mail')).toBe('10–20 Uhr, E-Mail');
    });
  });

  describe('heading → bold', () => {
    it('demotes # / ## / ### heading lines to bold', () => {
      expect(normalizeTelegramOutbound('# 622 Gewerbe\n### Hintergrund')).toBe('**622 Gewerbe**\n**Hintergrund**');
    });
    it('leaves a mid-sentence # alone', () => {
      expect(normalizeTelegramOutbound('Issue #648 ist offen')).toBe('Issue #648 ist offen');
    });
  });

  describe('• bullet → Markdown list item', () => {
    it('rewrites leading bullets so they become a real list (one item per line)', () => {
      expect(normalizeTelegramOutbound('Intro:\n• A\n• B\n• C')).toBe('Intro:\n- A\n- B\n- C');
    });
    it('preserves indentation of nested bullets', () => {
      expect(normalizeTelegramOutbound('  • nested')).toBe('  - nested');
    });
    it('leaves a mid-line • alone', () => {
      expect(normalizeTelegramOutbound('A • B inline')).toBe('A • B inline');
    });
  });

  describe('code is never touched', () => {
    it('leaves em-dashes, #, and • inside code spans and blocks', () => {
      expect(normalizeTelegramOutbound('`a — b`')).toBe('`a — b`');
      expect(normalizeTelegramOutbound('```\n# x\n• y\np — q\n```')).toBe('```\n# x\n• y\np — q\n```');
    });
  });

  it('is a no-op on empty input', () => {
    expect(normalizeTelegramOutbound('')).toBe('');
  });
});
