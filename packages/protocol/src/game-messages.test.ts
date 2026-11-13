import { describe, expect, it } from 'vitest';

import {
  anyGameActionIntentMessageSchema,
  anyGameEventsMessageSchema,
  anyGameStatePrivateMessageSchema,
  anyGameStatePublicMessageSchema,
  heartsActionIntentMessageSchema,
  heartsEventsMessageSchema,
  heartsStatePrivateMessageSchema,
  heartsStatePublicMessageSchema,
} from './game-messages';
import { actionIntentMessageSchema } from './client-messages';
import { statePublicMessageSchema } from './server-messages';

const seats = [
  { playerId: 'ana', seatIndex: 0, nickname: 'Ana', avatarId: null, kind: 'human', connected: true },
  { playerId: 'bot-1', seatIndex: 1, nickname: 'Bot 1', avatarId: null, kind: 'bot', connected: true },
];

const heartsPublic = {
  gameId: 'hearts',
  phase: 'passing',
  handIndex: 0,
  passDirection: 'left',
  currentTurnPlayerId: null,
  handSizes: [{ playerId: 'ana', count: 13 }],
  passConfirmed: [{ playerId: 'ana', confirmed: false }],
  trick: [],
  heartsBroken: false,
  totals: [{ playerId: 'ana', total: 0 }],
  lastHandPoints: null,
};
const fixturePublic = {
  gameId: 'fixture',
  status: 'playing',
  currentTurnPlayerId: 'ana',
  handSizes: [{ playerId: 'ana', count: 2 }],
  table: [],
  result: null,
};
const statePublic = { type: 'state_public', matchId: 'm1', roomCode: 'ABCD', version: 0, seats };

const heartsPrivate = {
  playerId: 'ana',
  hand: [{ id: 'p-2', suit: 'paus', value: '2' }],
  passSelection: null,
  legalActions: [{ type: 'play_card', cardId: 'p-2' }],
};
const fixturePrivate = {
  playerId: 'ana',
  hand: ['c1'],
  legalActions: [{ type: 'play_card', cardId: 'c1' }],
};

describe('state_public por jogo', () => {
  it('a união aceita a visão do fixture e a do Copas', () => {
    const fixture = { ...statePublic, game: fixturePublic };
    const hearts = { ...statePublic, game: heartsPublic };
    expect(anyGameStatePublicMessageSchema.safeParse(fixture).success).toBe(true);
    expect(anyGameStatePublicMessageSchema.safeParse(hearts).success).toBe(true);
  });

  it('o schema de cada jogo só aceita a própria visão', () => {
    const fixture = { ...statePublic, game: fixturePublic };
    const hearts = { ...statePublic, game: heartsPublic };
    expect(heartsStatePublicMessageSchema.safeParse(hearts).success).toBe(true);
    expect(heartsStatePublicMessageSchema.safeParse(fixture).success).toBe(false);
    expect(statePublicMessageSchema.safeParse(hearts).success).toBe(false);
  });

  it('rejeita mão no estado público do Copas', () => {
    const leaking = { ...statePublic, game: { ...heartsPublic, hands: [[]] } };
    expect(anyGameStatePublicMessageSchema.safeParse(leaking).success).toBe(false);
    expect(heartsStatePublicMessageSchema.safeParse(leaking).success).toBe(false);
  });

  it('rejeita visão de jogo desconhecido', () => {
    const unknown = { ...statePublic, game: { ...heartsPublic, gameId: 'poker' } };
    expect(anyGameStatePublicMessageSchema.safeParse(unknown).success).toBe(false);
  });
});

describe('state_private por jogo', () => {
  const envelope = { type: 'state_private', matchId: 'm1', version: 0 };

  it('a união aceita a visão do fixture e a do Copas', () => {
    expect(
      anyGameStatePrivateMessageSchema.safeParse({ ...envelope, view: fixturePrivate }).success,
    ).toBe(true);
    expect(
      anyGameStatePrivateMessageSchema.safeParse({ ...envelope, view: heartsPrivate }).success,
    ).toBe(true);
  });

  it('o schema do Copas recusa a visão do fixture', () => {
    expect(
      heartsStatePrivateMessageSchema.safeParse({ ...envelope, view: fixturePrivate }).success,
    ).toBe(false);
  });
});

describe('events por jogo', () => {
  const envelope = { type: 'events', matchId: 'm1', version: 1 };

  it('aceita os eventos do Copas, inclusive o passe sem cartas', () => {
    const events = [
      { type: 'pass_confirmed', playerId: 'ana' },
      { type: 'passing_completed' },
      { type: 'trick_won', playerId: 'ana', points: 1 },
    ];
    expect(anyGameEventsMessageSchema.safeParse({ ...envelope, events }).success).toBe(true);
    expect(heartsEventsMessageSchema.safeParse({ ...envelope, events }).success).toBe(true);
  });

  it('rejeita cartas no evento de passe', () => {
    const events = [{ type: 'pass_confirmed', playerId: 'ana', cardIds: ['a', 'b', 'c'] }];
    expect(anyGameEventsMessageSchema.safeParse({ ...envelope, events }).success).toBe(false);
  });

  it('rejeita lista que mistura eventos de jogos diferentes', () => {
    const events = [
      { type: 'pass_confirmed', playerId: 'ana' },
      { type: 'turn_changed', playerId: 'ana' },
    ];
    expect(anyGameEventsMessageSchema.safeParse({ ...envelope, events }).success).toBe(false);
  });
});

describe('action_intent por jogo', () => {
  const envelope = { type: 'action_intent', matchId: 'm1', stateVersion: 0 };
  const pass = { type: 'pass_cards', cardIds: ['a', 'b', 'c'] };
  const play = { type: 'play_card', cardId: 'a' };

  it('a união aceita o passe do Copas e a jogada comum', () => {
    expect(anyGameActionIntentMessageSchema.safeParse({ ...envelope, action: pass }).success).toBe(
      true,
    );
    expect(anyGameActionIntentMessageSchema.safeParse({ ...envelope, action: play }).success).toBe(
      true,
    );
  });

  it('o passe só existe no Copas', () => {
    expect(actionIntentMessageSchema.safeParse({ ...envelope, action: pass }).success).toBe(false);
    expect(heartsActionIntentMessageSchema.safeParse({ ...envelope, action: pass }).success).toBe(
      true,
    );
  });

  it('rejeita passe inválido e campo injetado', () => {
    const badPass = { type: 'pass_cards', cardIds: ['a', 'a', 'b'] };
    expect(
      anyGameActionIntentMessageSchema.safeParse({ ...envelope, action: badPass }).success,
    ).toBe(false);
    expect(
      anyGameActionIntentMessageSchema.safeParse({ ...envelope, action: { ...play, playerId: 'x' } })
        .success,
    ).toBe(false);
  });
});
