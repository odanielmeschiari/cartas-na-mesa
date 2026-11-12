import type { Rng } from './rng';

// Aliases locais espelham os tipos canônicos de docs/architecture/0001-fixture-contract.md §2.
// packages/core não importa packages/protocol (contrato §3); a compatibilidade é estrutural.
export type GameId = string;
export type PlayerId = string;
export type SeatIndex = number;
export type CardId = string;
export type Nickname = string;
export type AvatarId = string | null;

export type PlayerSeed = {
  playerId: PlayerId;
  seatIndex: SeatIndex;
  nickname: Nickname;
  avatarId: AvatarId;
};

// playerId vem da sessão autenticada no servidor, nunca do cliente.
export type EngineAction<A> = { playerId: PlayerId; payload: A };

export type EngineError = {
  code: 'not_your_turn' | 'card_not_in_hand' | 'game_finished' | 'invalid_setup';
  message: string;
};

export type ApplyResult<S, E> =
  { ok: true; state: S; events: readonly E[] } | { ok: false; error: EngineError };

export interface GameDefinition<S, A, P, V, R, E> {
  readonly id: GameId;
  readonly playerCount: { readonly min: number; readonly max: number };
  createInitialState(players: readonly PlayerSeed[], rng: Rng): S;
  legalActions(state: S, playerId: PlayerId): readonly A[];
  applyAction(state: S, action: EngineAction<A>): ApplyResult<S, E>;
  publicView(state: S): P;
  viewFor(state: S, playerId: PlayerId): V;
  resultOf(state: S): R | null;
}

// createInitialState não tem canal de erro na assinatura do contrato (§3).
// Setup inválido é exceção tipada, não um estado parcial silencioso.
export class InvalidSetupError extends Error {
  readonly code = 'invalid_setup' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidSetupError';
  }
}

// viewFor só pode ser chamado para quem pertence à partida; não existe visão vazia implícita.
export class UnknownPlayerError extends Error {
  readonly code = 'unknown_player' as const;
  readonly playerId: PlayerId;

  constructor(playerId: PlayerId) {
    super('Este jogador não pertence à partida.');
    this.name = 'UnknownPlayerError';
    this.playerId = playerId;
  }
}
