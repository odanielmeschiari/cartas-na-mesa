import { describe, expect, it } from 'vitest';

import { formatElapsed } from './format-time';

describe('formatElapsed', () => {
  it('formata minutos e segundos com dois dígitos', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65)).toBe('01:05');
  });

  it('mostra horas só a partir de uma hora', () => {
    expect(formatElapsed(3599)).toBe('59:59');
    expect(formatElapsed(3661)).toBe('1:01:01');
  });

  it('ignora valores negativos e frações', () => {
    expect(formatElapsed(-4)).toBe('00:00');
    expect(formatElapsed(9.9)).toBe('00:09');
  });
});
