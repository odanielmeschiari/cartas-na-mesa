import { z } from 'zod';

import { actionPayloadSchema } from './actions';
import {
  avatarIdSchema,
  cardIdSchema,
  nicknameSchema,
  playerIdSchema,
  seatIndexSchema,
} from './scalars';

// Objetos são strict para que campos desconhecidos (ex.: a mão) falhem na validação.
export const seatInfoSchema = z.strictObject({
  playerId: playerIdSchema,
  seatIndex: seatIndexSchema,
  nickname: nicknameSchema,
  avatarId: avatarIdSchema,
  connected: z.boolean(),
});

export const matchResultSchema = z.strictObject({
  outcome: z.literal('draw'),
});

export const fixturePublicViewSchema = z.strictObject({
  gameId: z.literal('fixture'),
  status: z.enum(['playing', 'finished']),
  currentTurnPlayerId: playerIdSchema.nullable(),
  handSizes: z
    .array(
      z.strictObject({
        playerId: playerIdSchema,
        count: z.number(),
      }),
    )
    .readonly(),
  table: z
    .array(
      z.strictObject({
        playerId: playerIdSchema,
        cardId: cardIdSchema,
      }),
    )
    .readonly(),
  result: matchResultSchema.nullable(),
});

export const fixturePrivateViewSchema = z.strictObject({
  playerId: playerIdSchema,
  hand: z.array(cardIdSchema).readonly(),
  legalActions: z.array(actionPayloadSchema).readonly(),
});

export const gameEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('card_played'),
    playerId: playerIdSchema,
    cardId: cardIdSchema,
  }),
  z.strictObject({
    type: z.literal('turn_changed'),
    playerId: playerIdSchema,
  }),
  z.strictObject({
    type: z.literal('match_finished'),
    result: matchResultSchema,
  }),
]);

export type SeatInfo = z.infer<typeof seatInfoSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;
export type FixturePublicView = z.infer<typeof fixturePublicViewSchema>;
export type FixturePrivateView = z.infer<typeof fixturePrivateViewSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
