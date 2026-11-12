import { describe, expect, it } from 'vitest';

import {
  actionIntentMessageSchema,
  clientMessageSchema,
  createRoomMessageSchema,
  joinRoomMessageSchema,
  reconnectMessageSchema,
} from './client-messages';

const createRoom = { type: 'create_room', nickname: 'Ana', avatarId: null } as const;
const joinRoom = {
  type: 'join_room',
  roomCode: 'ABCD',
  nickname: 'Ana',
  avatarId: 'avatar-1',
} as const;
const reconnect = { type: 'reconnect', roomCode: 'ABCD', sessionToken: 'token' } as const;
const actionIntent = {
  type: 'action_intent',
  matchId: 'm1',
  stateVersion: 0,
  action: { type: 'play_card', cardId: 'c1' },
} as const;

describe('create_room', () => {
  it('aceita payload válido', () => {
    expect(createRoomMessageSchema.safeParse(createRoom).success).toBe(true);
  });

  it('rejeita campo faltando', () => {
    expect(
      createRoomMessageSchema.safeParse({ type: 'create_room', nickname: 'Ana' }).success,
    ).toBe(false);
  });

  it('rejeita tipo errado', () => {
    expect(createRoomMessageSchema.safeParse({ ...createRoom, nickname: 1 }).success).toBe(false);
  });

  it('rejeita campo extra', () => {
    expect(createRoomMessageSchema.safeParse({ ...createRoom, playerId: 'p1' }).success).toBe(
      false,
    );
  });
});

describe('join_room', () => {
  it('aceita payload válido', () => {
    expect(joinRoomMessageSchema.safeParse(joinRoom).success).toBe(true);
  });

  it('rejeita campo faltando', () => {
    expect(
      joinRoomMessageSchema.safeParse({
        type: 'join_room',
        nickname: 'Ana',
        avatarId: null,
      }).success,
    ).toBe(false);
  });

  it('rejeita tipo errado', () => {
    expect(joinRoomMessageSchema.safeParse({ ...joinRoom, roomCode: 1 }).success).toBe(false);
  });

  it('rejeita campo extra', () => {
    expect(joinRoomMessageSchema.safeParse({ ...joinRoom, seatIndex: 1 }).success).toBe(false);
  });
});

describe('reconnect', () => {
  it('aceita payload válido', () => {
    expect(reconnectMessageSchema.safeParse(reconnect).success).toBe(true);
  });

  it('rejeita campo faltando', () => {
    expect(reconnectMessageSchema.safeParse({ type: 'reconnect', roomCode: 'ABCD' }).success).toBe(
      false,
    );
  });

  it('rejeita tipo errado', () => {
    expect(reconnectMessageSchema.safeParse({ ...reconnect, sessionToken: null }).success).toBe(
      false,
    );
  });

  it('rejeita campo extra', () => {
    expect(reconnectMessageSchema.safeParse({ ...reconnect, nickname: 'Ana' }).success).toBe(false);
  });
});

describe('action_intent', () => {
  it('aceita payload válido', () => {
    expect(actionIntentMessageSchema.safeParse(actionIntent).success).toBe(true);
  });

  it('rejeita campo faltando', () => {
    expect(
      actionIntentMessageSchema.safeParse({
        type: 'action_intent',
        matchId: 'm1',
        action: { type: 'play_card', cardId: 'c1' },
      }).success,
    ).toBe(false);
  });

  it('rejeita tipo errado', () => {
    expect(
      actionIntentMessageSchema.safeParse({ ...actionIntent, stateVersion: '0' }).success,
    ).toBe(false);
  });

  it('rejeita campo extra', () => {
    expect(actionIntentMessageSchema.safeParse({ ...actionIntent, seatIndex: 0 }).success).toBe(
      false,
    );
  });

  it('rejeita playerId injetado pelo cliente', () => {
    expect(actionIntentMessageSchema.safeParse({ ...actionIntent, playerId: 'p1' }).success).toBe(
      false,
    );
  });

  it('rejeita playerId dentro da ação', () => {
    expect(
      actionIntentMessageSchema.safeParse({
        ...actionIntent,
        action: { ...actionIntent.action, playerId: 'p1' },
      }).success,
    ).toBe(false);
  });
});

describe('clientMessageSchema', () => {
  it('aceita as quatro mensagens do contrato', () => {
    expect(clientMessageSchema.safeParse(createRoom).success).toBe(true);
    expect(clientMessageSchema.safeParse(joinRoom).success).toBe(true);
    expect(clientMessageSchema.safeParse(reconnect).success).toBe(true);
    expect(clientMessageSchema.safeParse(actionIntent).success).toBe(true);
  });

  it('rejeita type desconhecido', () => {
    expect(clientMessageSchema.safeParse({ type: 'leave_room' }).success).toBe(false);
  });
});
