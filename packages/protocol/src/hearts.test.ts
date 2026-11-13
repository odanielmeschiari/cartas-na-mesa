import { describe, expect, it } from 'vitest';

import {
  heartsActionPayloadSchema,
  heartsEventSchema,
  heartsPrivateViewSchema,
  heartsPublicViewSchema,
  heartsResultSchema,
} from './hearts';

const card = { id: 'p-2', suit: 'paus', value: '2' } as const;
const publicView = {
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
} as const;
const privateView = {
  playerId: 'ana',
  hand: [card],
  passSelection: null,
  legalActions: [{ type: 'play_card', cardId: 'p-2' }],
} as const;

describe('heartsActionPayloadSchema', () => {
  it('aceita pass_cards com 3 cartas diferentes e play_card', () => {
    expect(
      heartsActionPayloadSchema.safeParse({ type: 'pass_cards', cardIds: ['a', 'b', 'c'] }).success,
    ).toBe(true);
    expect(heartsActionPayloadSchema.safeParse({ type: 'play_card', cardId: 'a' }).success).toBe(
      true,
    );
  });

  it('rejeita passe com quantidade errada ou cartas repetidas', () => {
    const parse = (cardIds: string[]) =>
      heartsActionPayloadSchema.safeParse({ type: 'pass_cards', cardIds }).success;
    expect(parse(['a', 'b'])).toBe(false);
    expect(parse(['a', 'b', 'c', 'd'])).toBe(false);
    expect(parse(['a', 'a', 'b'])).toBe(false);
    expect(parse(['a', 'b', ''])).toBe(false);
  });

  it('rejeita campo injetado e tipo desconhecido', () => {
    expect(
      heartsActionPayloadSchema.safeParse({ type: 'play_card', cardId: 'a', playerId: 'x' })
        .success,
    ).toBe(false);
    expect(heartsActionPayloadSchema.safeParse({ type: 'fold' }).success).toBe(false);
  });
});

describe('visões do Copas', () => {
  it('aceita a visão pública e a privada válidas', () => {
    expect(heartsPublicViewSchema.safeParse(publicView).success).toBe(true);
    expect(heartsPrivateViewSchema.safeParse(privateView).success).toBe(true);
  });

  it('a visão pública rejeita mãos e seleção de passe', () => {
    expect(heartsPublicViewSchema.safeParse({ ...publicView, hands: [[card]] }).success).toBe(
      false,
    );
    expect(heartsPublicViewSchema.safeParse({ ...publicView, passSelection: [] }).success).toBe(
      false,
    );
  });

  it('rejeita fase, direção e naipe fora do contrato', () => {
    expect(heartsPublicViewSchema.safeParse({ ...publicView, phase: 'bidding' }).success).toBe(
      false,
    );
    expect(heartsPublicViewSchema.safeParse({ ...publicView, passDirection: 'up' }).success).toBe(
      false,
    );
    const badCard = { ...card, suit: 'copas' };
    expect(heartsPrivateViewSchema.safeParse({ ...privateView, hand: [badCard] }).success).toBe(
      false,
    );
  });

  it('a visão privada aceita a seleção de passe do próprio jogador', () => {
    const view = { ...privateView, passSelection: ['a', 'b', 'c'] };
    expect(heartsPrivateViewSchema.safeParse(view).success).toBe(true);
  });
});

describe('eventos e resultado do Copas', () => {
  it('aceita cada evento válido', () => {
    const events = [
      { type: 'pass_confirmed', playerId: 'ana' },
      { type: 'passing_completed' },
      { type: 'card_played', playerId: 'ana', cardId: 'p-2' },
      { type: 'trick_won', playerId: 'ana', points: 14 },
      { type: 'hand_finished', points: [0, 26, 0, 0], moonShooter: null },
      { type: 'game_finished', winners: ['ana'] },
    ];
    for (const event of events) {
      expect(heartsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('pass_confirmed não aceita cartas', () => {
    const event = { type: 'pass_confirmed', playerId: 'ana', cardIds: ['a', 'b', 'c'] };
    expect(heartsEventSchema.safeParse(event).success).toBe(false);
  });

  it('valida o resultado', () => {
    const result = { winners: ['ana'], totals: [10, 90, 50, 101] };
    expect(heartsResultSchema.safeParse(result).success).toBe(true);
    expect(heartsResultSchema.safeParse({ winners: ['ana'] }).success).toBe(false);
  });
});
