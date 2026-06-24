import { describe, expect, it } from 'vitest';

import { enforceGermanTypography } from './telegram-typography.js';

describe('enforceGermanTypography', () => {
  it('rewrites a spaced em-dash to a spaced en-dash', () => {
    expect(enforceGermanTypography('Pata Soul ist drin — Status offen.')).toBe(
      'Pata Soul ist drin – Status offen.',
    );
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
