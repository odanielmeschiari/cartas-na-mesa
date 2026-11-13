import {
  chooseEasyAction,
  fixtureGame,
  heartsGame,
  startNextHand,
  type FixtureActionPayload,
  type FixtureEvent,
  type FixturePrivateView,
  type FixturePublicView,
  type GameDefinition,
  type HeartsActionPayload,
  type HeartsEvent,
  type HeartsPrivateView,
  type HeartsPublicView,
  type HeartsResult,
  type HeartsState,
  type MatchResult,
  type Rng,
} from '@cartas-na-mesa/core';
import {
  actionIntentMessageSchema,
  actionPayloadSchema,
  eventsMessageSchema,
  heartsActionIntentMessageSchema,
  heartsActionPayloadSchema,
  heartsEventsMessageSchema,
  heartsStatePrivateMessageSchema,
  heartsStatePublicMessageSchema,
  statePrivateMessageSchema,
  statePublicMessageSchema,
} from '@cartas-na-mesa/protocol';
import type { ZodType } from 'zod';

// Doc 0003 §2: a sala é genérica e recebe do jogo um adaptador. A infraestrutura de salas não
// conhece regra de jogo (regra 12 do AGENTS.md); tudo o que é específico de um jogo entra por
// aqui: o motor, os schemas de rede e, quando existir, o bot.

/** Schemas das mensagens que carregam payload de jogo (ADR-002). */
export interface GameMessageSchemas {
  readonly actionIntent: ZodType;
  readonly statePublic: ZodType;
  readonly statePrivate: ZodType;
  readonly events: ZodType;
}

/**
 * Transição que o motor não faz sozinho porque `applyAction` não recebe `Rng` (ex.: distribuir a
 * próxima mão do Copas). A sala a executa depois de uma pausa, com o `Rng` da própria sala.
 */
export interface GameAdvance<S> {
  /** O estado está parado esperando a sala avançar? */
  readonly isPending: (state: S) => boolean;
  readonly apply: (state: S, rng: Rng) => S;
}

export interface GameRoomAdapter<S, A, P, V, R, E> {
  readonly game: GameDefinition<S, A, P, V, R, E>;
  /** Revalida a ação depois do envelope: uma ação de outro jogo falha com `invalid_payload`. */
  readonly actionSchema: ZodType<A>;
  readonly messages: GameMessageSchemas;
  /** Ausente nos jogos cujo motor avança só com ações de jogadores. */
  readonly advance?: GameAdvance<S>;
  /** O jogo aceita bots nos assentos vagos. */
  readonly fillWithBots: boolean;
  /** Só enxerga a visão do próprio assento e a pública, nunca o estado completo. */
  readonly chooseBotAction?: (own: V, table: P) => A | null;
}

export type FixtureState = ReturnType<typeof fixtureGame.createInitialState>;

export const fixtureAdapter: GameRoomAdapter<
  FixtureState,
  FixtureActionPayload,
  FixturePublicView,
  FixturePrivateView,
  MatchResult,
  FixtureEvent
> = {
  game: fixtureGame,
  actionSchema: actionPayloadSchema,
  messages: {
    actionIntent: actionIntentMessageSchema,
    statePublic: statePublicMessageSchema,
    statePrivate: statePrivateMessageSchema,
    events: eventsMessageSchema,
  },
  fillWithBots: false,
};

export const heartsAdapter: GameRoomAdapter<
  HeartsState,
  HeartsActionPayload,
  HeartsPublicView,
  HeartsPrivateView,
  HeartsResult,
  HeartsEvent
> = {
  game: heartsGame,
  actionSchema: heartsActionPayloadSchema,
  messages: {
    actionIntent: heartsActionIntentMessageSchema,
    statePublic: heartsStatePublicMessageSchema,
    statePrivate: heartsStatePrivateMessageSchema,
    events: heartsEventsMessageSchema,
  },
  advance: {
    isPending: (state) => state.phase === 'hand_over',
    apply: startNextHand,
  },
  fillWithBots: true,
  chooseBotAction: chooseEasyAction,
};
