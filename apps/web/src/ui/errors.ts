import type { ErrorCode } from '@cartas-na-mesa/protocol';

/**
 * Textos seguros para exibição, um por código de erro do contrato.
 *
 * A tabela é da **UI**, e não do servidor: ela existe para que nenhum texto
 * recebido pela rede seja exibido como está. O `message` que vem do servidor
 * é ignorado de propósito — a regra 15 (entrada externa é hostil) vale também
 * para a mensagem de erro, e o `code` é a única parte em que se confia.
 *
 * Os textos coincidem com os do servidor (`ERROR_MESSAGES` em
 * `apps/server/src/rooms/fixture.ts`) para que a falhas de matchmaking
 * traduzidas na borda e as falhas de protocolo faladas na tela digam a mesma
 * coisa.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_payload: 'Mensagem inválida.',
  room_not_found: 'Sala não encontrada.',
  room_full: 'A sala está cheia.',
  session_invalid: 'Sessão inválida. Entre na sala novamente.',
  match_not_found: 'Partida não encontrada.',
  stale_state: 'O estado da partida mudou. Tente de novo.',
  not_your_turn: 'Não é o seu turno.',
  card_not_in_hand: 'Essa carta não está na sua mão.',
  game_finished: 'A partida não está em andamento.',
  internal: 'Erro interno do servidor.',
};

/**
 * Texto de exibição de um erro do protocolo.
 *
 * O `message` recebido é **descartado**: só o `code` decide o texto, para
 * que a tela nunca mostre uma mensagem crua vinda da rede.
 */
export function describeError(error: { code: ErrorCode }): string {
  return ERROR_MESSAGES[error.code];
}

/** Texto de exibição de um código de erro do protocolo. */
export function describeErrorCode(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
