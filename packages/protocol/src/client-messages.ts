import { z } from 'zod';

import { actionPayloadSchema } from './actions';
import {
  avatarIdSchema,
  matchIdSchema,
  nicknameSchema,
  roomCodeSchema,
  sessionTokenSchema,
  stateVersionSchema,
} from './scalars';

// Strict em todas as mensagens para rejeitar campos fora do contrato, como playerId.
export const createRoomMessageSchema = z.strictObject({
  type: z.literal('create_room'),
  nickname: nicknameSchema,
  avatarId: avatarIdSchema,
});

export const joinRoomMessageSchema = z.strictObject({
  type: z.literal('join_room'),
  roomCode: roomCodeSchema,
  nickname: nicknameSchema,
  avatarId: avatarIdSchema,
});

export const reconnectMessageSchema = z.strictObject({
  type: z.literal('reconnect'),
  roomCode: roomCodeSchema,
  sessionToken: sessionTokenSchema,
});

export const actionIntentMessageSchema = z.strictObject({
  type: z.literal('action_intent'),
  matchId: matchIdSchema,
  stateVersion: stateVersionSchema,
  action: actionPayloadSchema,
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  createRoomMessageSchema,
  joinRoomMessageSchema,
  reconnectMessageSchema,
  actionIntentMessageSchema,
]);

export type CreateRoomMessage = z.infer<typeof createRoomMessageSchema>;
export type JoinRoomMessage = z.infer<typeof joinRoomMessageSchema>;
export type ReconnectMessage = z.infer<typeof reconnectMessageSchema>;
export type ActionIntentMessage = z.infer<typeof actionIntentMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
