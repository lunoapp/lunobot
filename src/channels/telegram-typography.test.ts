import { describe, expect, it } from 'vitest';

import { demoteTelegramHeadings, enforceGermanTypography } from './telegram-typography.js';

describe('enforceGermanTypography', () => {
  it('rewrites a spaced em-dash to a spaced en-dash', () => {
    expect(enforceGermanTypography('Pata Soul ist drin — Status offen.')).toBe('Pata Soul ist drin – Status offen.');
  });

  it('rewrites multiple em-dashes in one message', () => {
    expect(enforceGermanTypography('a — b — c')).toBe('a – b – c');
  });

  it('leaves en-dashes and hyphens untouched', () => {
    expect(enforceGermanTypography('10–20 Uhr, E-Mail')).toBe('10–20 Uhr, E-Mail');
  });

  it('does not touch em-dashes inside inline code or code blocks', () => {
    expect(enforceGermanTypography('Run `a — b` now')).toBe('Run `a — b` now');
    expect(enforceGermanTypography('```\nx — y\n```')).toBe('```\nx — y\n```');
  });

  it('is a no-op on empty input', () => {
    expect(enforceGermanTypography('')).toBe('');
  });
});

describe('demoteTelegramHeadings', () => {
  it('converts # / ## / ### headings to bold', () => {
    expect(demoteTelegramHeadings('# 622 Gewerbeanmeldung')).toBe('**622 Gewerbeanmeldung**');
    expect(demoteTelegramHeadings('### Hintergrund')).toBe('**Hintergrund**');
  });

  it('demotes only heading lines, leaving surrounding text', () => {
    expect(demoteTelegramHeadings('Intro\n## Titel\n- Punkt')).toBe('Intro\n**Titel**\n- Punkt');
  });

  it('leaves a `#` that is not a heading marker alone', () => {
    expect(demoteTelegramHeadings('Issue #648 ist offen')).toBe('Issue #648 ist offen');
  });

  it('does not touch `#` lines inside code blocks', () => {
    expect(demoteTelegramHeadings('```\n# not a heading\n```')).toBe('```\n# not a heading\n```');
  });
});
