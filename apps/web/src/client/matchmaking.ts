import { ErrorCode as ColyseusErrorCode } from '@colyseus/sdk';
import type { ErrorCode } from '@cartas-na-mesa/protocol';

/**
 * Erro no vocabulário do protocolo: o mesmo conjunto de `code` que a UI
 * recebe nas mensagens `error` do servidor (contrato §5).
 */
export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

/**
 * Textos fixos, iguais aos do servidor (`ERROR_MESSAGES` em
 * `apps/server/src/rooms/fixture.ts`): seguros para exibição e sem eco do
 * erro original, que pode carregar detalhe interno do servidor.
 *
 * Só entram os textos que este módulo produz — a tabela completa do
 * contrato continua em um lugar só, no servidor.
 */
const MESSAGES = {
  room_not_found: 'Sala não encontrada.',
  room_full: 'A sala está cheia.',
  internal: 'Erro interno do servidor.',
} as const;

/** Verdadeiro para qualquer objeto não nulo (inclusive arrays). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Código numérico do erro do Colyseus, quando existe.
 *
 * A falha de rede do SDK pode trazer um código em string (`ECONNREFUSED`),
 * que não é um `ErrorCode` do Colyseus: nesse caso não há código numérico.
 */
function readCode(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }

  const code = error['code'];
  return typeof code === 'number' ? code : null;
}

/** Texto do erro, quando existe. */
function readMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (!isRecord(error)) {
    return '';
  }

  const message = error['message'];
  return typeof message === 'string' ? message : '';
}

/**
 * Traduz a falha do **matchmaking** — que acontece antes do WebSocket
 * existir — para o mesmo conjunto de `code` do protocolo (doc 0002 §5.1).
 *
 * A detecção usa **propriedades estruturadas** (`code` numérico do
 * Colyseus) e não `instanceof`: o pnpm isola as dependências, e a classe
 * `MatchMakeError` pode existir em mais de uma cópia no `node_modules`.
 *
 * | Condição                                            | `code`           |
 * | --------------------------------------------------- | ---------------- |
 * | `MATCHMAKE_INVALID_CRITERIA` (nenhuma sala achada)   | `room_not_found` |
 * | texto `is already full` / `is locked`                | `room_full`      |
 * | `MATCHMAKE_INVALID_ROOM_ID` (sala inexistente)       | `room_not_found` |
 * | qualquer outra falha                                 | `internal`       |
 *
 * O texto `is locked` vem com o **mesmo** código de sala inexistente
 * (`MATCHMAKE_INVALID_ROOM_ID`), então a ordem das verificações importa: o
 * texto é conferido antes do código.
 *
 * A função é total: nunca lança e devolve sempre um erro do protocolo.
 */
export function translateMatchmakingError(error: unknown): ProtocolError {
  const code = readCode(error);
  const message = readMessage(error);

  if (code === ColyseusErrorCode.MATCHMAKE_INVALID_CRITERIA) {
    return { code: 'room_not_found', message: MESSAGES.room_not_found };
  }

  if (message.includes('is already full') || message.includes('is locked')) {
    return { code: 'room_full', message: MESSAGES.room_full };
  }

  if (code === ColyseusErrorCode.MATCHMAKE_INVALID_ROOM_ID) {
    return { code: 'room_not_found', message: MESSAGES.room_not_found };
  }

  return { code: 'internal', message: MESSAGES.internal };
}
