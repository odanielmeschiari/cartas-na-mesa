import { z } from 'zod';

import { cardIdSchema, playerIdSchema } from './scalars';

// Contratos de rede do Copas (docs/rules/copas.md). Espelham, de forma estrutural, as ações,
// visões e eventos de packages/core/src/hearts-game.ts; o core não importa este pacote.
// Objetos strict: campo fora do contrato, como a mão de outro jogador, falha na validação.

export const HEARTS_PASS_COUNT = 3;

export const heartsCardSchema = z.strictObject({
  id: cardIdSchema,
  suit: z.enum(['ouro', 'copa', 'espada', 'paus']),
  value: z.enum(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']),
});

export const heartsActionPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('pass_cards'),
    cardIds: z
      .array(cardIdSchema)
      .length(HEARTS_PASS_COUNT)
      .refine((ids: string[]) => new Set(ids).size === ids.length, {
        message: 'O passe exige cartas diferentes.',
      }),
  }),
  z.strictObject({ type: z.literal('play_card'), cardId: cardIdSchema }),
]);

export const heartsPhaseSchema = z.enum(['passing', 'playing', 'hand_over', 'finished']);
export const heartsPassDirectionSchema = z.enum(['left', 'right', 'across', 'none']);

export const heartsPublicViewSchema = z.strictObject({
  gameId: z.literal('hearts'),
  phase: heartsPhaseSchema,
  handIndex: z.number().int().nonnegative(),
  passDirection: heartsPassDirectionSchema,
  currentTurnPlayerId: playerIdSchema.nullable(),
  handSizes: z
    .array(z.strictObject({ playerId: playerIdSchema, count: z.number().int().nonnegative() }))
    .readonly(),
  passConfirmed: z
    .array(z.strictObject({ playerId: playerIdSchema, confirmed: z.boolean() }))
    .readonly(),
  trick: z.array(z.strictObject({ playerId: playerIdSchema, cardId: cardIdSchema })).readonly(),
  heartsBroken: z.boolean(),
  totals: z.array(z.strictObject({ playerId: playerIdSchema, total: z.number().int() })).readonly(),
  lastHandPoints: z.array(z.number().int().nonnegative()).readonly().nullable(),
});

export const heartsPrivateViewSchema = z.strictObject({
  playerId: playerIdSchema,
  hand: z.array(heartsCardSchema).readonly(),
  passSelection: z.array(cardIdSchema).readonly().nullable(),
  legalActions: z.array(heartsActionPayloadSchema).readonly(),
});

export const heartsResultSchema = z.strictObject({
  winners: z.array(playerIdSchema).readonly(),
  totals: z.array(z.number().int()).readonly(),
});

// pass_confirmed não carrega cartas de propósito: o passe é oculto até a troca.
export const heartsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('pass_confirmed'), playerId: playerIdSchema }),
  z.strictObject({ type: z.literal('passing_completed') }),
  z.strictObject({
    type: z.literal('card_played'),
    playerId: playerIdSchema,
    cardId: cardIdSchema,
  }),
  z.strictObject({
    type: z.literal('trick_won'),
    playerId: playerIdSchema,
    points: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('hand_finished'),
    points: z.array(z.number().int().nonnegative()).readonly(),
    moonShooter: playerIdSchema.nullable(),
  }),
  z.strictObject({ type: z.literal('game_finished'), winners: z.array(playerIdSchema).readonly() }),
]);

export type HeartsCard = z.infer<typeof heartsCardSchema>;
export type HeartsActionPayload = z.infer<typeof heartsActionPayloadSchema>;
export type HeartsPublicView = z.infer<typeof heartsPublicViewSchema>;
export type HeartsPrivateView = z.infer<typeof heartsPrivateViewSchema>;
export type HeartsResult = z.infer<typeof heartsResultSchema>;
export type HeartsEvent = z.infer<typeof heartsEventSchema>;
