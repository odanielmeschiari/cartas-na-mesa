import { describe, expect, it } from 'vitest';

import { describeError, describeErrorCode, ERROR_MESSAGES } from './errors';

describe('describeErrorCode', () => {
  it('traduz os códigos de falha de matchmaking', () => {
    expect(describeErrorCode('room_not_found')).toBe('Sala não encontrada.');
    expect(describeErrorCode('room_full')).toBe('A sala está cheia.');
    expect(describeErrorCode('internal')).toBe('Erro interno do servidor.');
  });

  it('traduz os códigos de erro de protocolo', () => {
    expect(describeErrorCode('not_your_turn')).toBe('Não é o seu turno.');
    expect(describeErrorCode('card_not_in_hand')).toBe('Essa carta não está na sua mão.');
    expect(describeErrorCode('session_invalid')).toBe('Sessão inválida. Entre na sala novamente.');
  });
});

describe('describeError', () => {
  it('nunca devolve a mensagem crua do servidor', () => {
    const received = {
      code: 'internal' as const,
      message: 'falha em /srv/app/segredo.ts linha 42',
    };

    expect(describeError(received)).toBe('Erro interno do servidor.');
    expect(describeError(received)).not.toContain('/srv/app');
  });
});

describe('ERROR_MESSAGES', () => {
  it('tem texto para todos os códigos do protocolo', () => {
    const codes = Object.keys(ERROR_MESSAGES);

    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES].length).toBeGreaterThan(0);
    }
  });
});
