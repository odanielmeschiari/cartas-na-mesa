import { ErrorCode as ColyseusErrorCode } from '@colyseus/sdk';
import { describe, expect, it } from 'vitest';

import { translateMatchmakingError } from './matchmaking';

/**
 * Erro com as mesmas propriedades estruturadas do `MatchMakeError` do SDK:
 * o `code` numérico do Colyseus e a mensagem do servidor.
 */
function matchmakingError(message: string, code: number): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

describe('translateMatchmakingError', () => {
  it('traduz sala inexistente para room_not_found', () => {
    const error = matchmakingError(
      'room "ABC123" not found',
      ColyseusErrorCode.MATCHMAKE_INVALID_ROOM_ID,
    );

    expect(translateMatchmakingError(error)).toEqual({
      code: 'room_not_found',
      message: 'Sala não encontrada.',
    });
  });

  it('traduz sala descartada para room_not_found', () => {
    const error = matchmakingError(
      'room "ABC123" has been disposed.',
      ColyseusErrorCode.MATCHMAKE_INVALID_ROOM_ID,
    );

    expect(translateMatchmakingError(error).code).toBe('room_not_found');
  });

  it('traduz sala cheia para room_full', () => {
    const error = matchmakingError(
      'ABC123 is already full.',
      ColyseusErrorCode.MATCHMAKE_UNHANDLED,
    );

    expect(translateMatchmakingError(error)).toEqual({
      code: 'room_full',
      message: 'A sala está cheia.',
    });
  });

  it('traduz sala trancada para room_full, apesar do código de sala inexistente', () => {
    const error = matchmakingError(
      'room "ABC123" is locked',
      ColyseusErrorCode.MATCHMAKE_INVALID_ROOM_ID,
    );

    expect(translateMatchmakingError(error)).toEqual({
      code: 'room_full',
      message: 'A sala está cheia.',
    });
  });

  it('traduz critérios inválidos para room_not_found', () => {
    const error = matchmakingError(
      'no rooms found with provided criteria',
      ColyseusErrorCode.MATCHMAKE_INVALID_CRITERIA,
    );

    expect(translateMatchmakingError(error)).toEqual({
      code: 'room_not_found',
      message: 'Sala não encontrada.',
    });
  });

  it('traduz erro genérico para internal', () => {
    const error = matchmakingError('boom', ColyseusErrorCode.MATCHMAKE_UNHANDLED);

    expect(translateMatchmakingError(error)).toEqual({
      code: 'internal',
      message: 'Erro interno do servidor.',
    });
  });

  it('traduz erro sem código para internal', () => {
    expect(translateMatchmakingError(new Error('boom')).code).toBe('internal');
  });

  it('traduz código não numérico para internal', () => {
    const error = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });

    expect(translateMatchmakingError(error).code).toBe('internal');
  });

  it('não lança com entradas sem Error', () => {
    expect(translateMatchmakingError(undefined).code).toBe('internal');
    expect(translateMatchmakingError(null).code).toBe('internal');
    expect(translateMatchmakingError('boom').code).toBe('internal');
    expect(translateMatchmakingError(42).code).toBe('internal');
    expect(translateMatchmakingError({}).code).toBe('internal');
  });

  it('nunca devolve a mensagem crua do servidor', () => {
    const error = matchmakingError(
      'room "ABC123" not found (detalhe interno)',
      ColyseusErrorCode.MATCHMAKE_INVALID_ROOM_ID,
    );

    expect(translateMatchmakingError(error).message).toBe('Sala não encontrada.');
  });
});
