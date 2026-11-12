import { z } from 'zod';

import { errorCodeSchema } from './errors';
import {
  matchIdSchema,
  playerIdSchema,
  roomCodeSchema,
  seatIndexSchema,
  sessionTokenSchema,
  stateVersionSchema,
} from './scalars';
import {
  fixturePrivateViewSchema,
  fixturePublicViewSchema,
  gameEventSchema,
  seatInfoSchema,
} from './views';

// Strict em todas as mensagens para que campos fora do contrato falhem na validação.
export const joinAcceptedMessageSchema = z.strictObject({
  type: z.literal('join_accepted'),
  roomCode: roomCodeSchema,
  matchId: matchIdSchema,
  playerId: playerIdSchema,
  seatIndex: seatIndexSchema,
  sessionToken: sessionTokenSchema,
});

export const roomWaitingMessageSchema = z.strictObject({
  type: z.literal('room_waiting'),
  roomCode: roomCodeSchema,
  seats: z.array(seatInfoSchema),
});

export const statePublicMessageSchema = z.strictObject({
  type: z.literal('state_public'),
  matchId: matchIdSchema,
  roomCode: roomCodeSchema,
  version: stateVersionSchema,
  seats: z.array(seatInfoSchema),
  game: fixturePublicViewSchema,
});

export const statePrivateMessageSchema = z.strictObject({
  type: z.literal('state_private'),
  matchId: matchIdSchema,
  version: stateVersionSchema,
  view: fixturePrivateViewSchema,
});

export const eventsMessageSchema = z.strictObject({
  type: z.literal('events'),
  matchId: matchIdSchema,
  version: stateVersionSchema,
  events: z.array(gameEventSchema),
});

export const errorMessageSchema = z.strictObject({
  type: z.literal('error'),
  code: errorCodeSchema,
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  joinAcceptedMessageSchema,
  roomWaitingMessageSchema,
  statePublicMessageSchema,
  statePrivateMessageSchema,
  eventsMessageSchema,
  errorMessageSchema,
]);

export type JoinAcceptedMessage = z.infer<typeof joinAcceptedMessageSchema>;
export type RoomWaitingMessage = z.infer<typeof roomWaitingMessageSchema>;
export type StatePublicMessage = z.infer<typeof statePublicMessageSchema>;
export type StatePrivateMessage = z.infer<typeof statePrivateMessageSchema>;
export type EventsMessage = z.infer<typeof eventsMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
