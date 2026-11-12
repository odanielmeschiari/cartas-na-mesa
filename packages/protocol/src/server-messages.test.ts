import { describe, expect, it } from 'vitest';

import {
  errorMessageSchema,
  eventsMessageSchema,
  joinAcceptedMessageSchema,
  roomWaitingMessageSchema,
  serverMessageSchema,
  statePrivateMessageSchema,
  statePublicMessageSchema,
} from './server-messages';

const seats = [
  {
    playerId: 'p1',
    seatIndex: 0,
    nickname: 'Ana',
    avatarId: null,
    connected: true,
  },
  {
    playerId: 'p2',
    seatIndex: 1,
    nickname: 'Beto',
    avatarId: 'avatar-2',
    connected: true,
  },
];

const publicView = {
  gameId: 'fixture',
  status: 'playing',
  currentTurnPlayerId: 'p1',
  handSizes: [
    { playerId: 'p1', count: 2 },
    { playerId: 'p2', count: 2 },
  ],
  table: [],
  result: null,
};

const joinAccepted = {
  type: 'join_accepted',
  roomCode: 'ABCD',
  matchId: 'm1',
  playerId: 'p1',
  seatIndex: 0,
  sessionToken: 'token',
} as const;

const roomWaiting = { type: 'room_waiting', roomCode: 'ABCD', seats } as const;

const statePublic = {
  type: 'state_public',
  matchId: 'm1',
  roomCode: 'ABCD',
  version: 0,
  seats,
  game: publicView,
} as const;

const statePrivate = {
  type: 'state_private',
  matchId: 'm1',
  version: 0,
  view: {
    playerId: 'p1',
    hand: ['c1', 'c3'],
    legalActions: [{ type: 'play_card', cardId: 'c1' }],
  },
} as const;

describe('join_accepted', () => {
  it('aceita payload válido', () => {
    expect(joinAcceptedMessageSchema.safeParse(joinAccepted).success).toBe(true);
  });

  it('rejeita campo extra', () => {
    expect(joinAcceptedMessageSchema.safeParse({ ...joinAccepted, connected: true }).success).toBe(
      false,
    );
  });
});

describe('room_waiting', () => {
  it('aceita payload válido', () => {
    expect(roomWaitingMessageSchema.safeParse(roomWaiting).success).toBe(true);
  });

  it('rejeita assento com campo desconhecido', () => {
    expect(
      roomWaitingMessageSchema.safeParse({
        ...roomWaiting,
        seats: [
          {
            playerId: 'p1',
            seatIndex: 0,
            nickname: 'Ana',
            avatarId: null,
            connected: true,
            hand: ['c1'],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('state_public', () => {
  it('aceita payload válido', () => {
    expect(statePublicMessageSchema.safeParse(statePublic).success).toBe(true);
  });

  it('rejeita hand no topo da mensagem', () => {
    expect(statePublicMessageSchema.safeParse({ ...statePublic, hand: ['c1'] }).success).toBe(
      false,
    );
  });

  it('rejeita hand dentro da visão pública', () => {
    expect(
      statePublicMessageSchema.safeParse({
        ...statePublic,
        game: { ...publicView, hand: ['c1'] },
      }).success,
    ).toBe(false);
  });

  it('rejeita status fora do contrato', () => {
    expect(
      statePublicMessageSchema.safeParse({
        ...statePublic,
        game: { ...publicView, status: 'waiting' },
      }).success,
    ).toBe(false);
  });
});

describe('state_private', () => {
  it('aceita payload válido', () => {
    expect(statePrivateMessageSchema.safeParse(statePrivate).success).toBe(true);
  });

  it('rejeita cardId vazio na mão', () => {
    expect(
      statePrivateMessageSchema.safeParse({
        ...statePrivate,
        view: { ...statePrivate.view, hand: [''] },
      }).success,
    ).toBe(false);
  });

  it('rejeita cardId não textual na mão', () => {
    expect(
      statePrivateMessageSchema.safeParse({
        ...statePrivate,
        view: { ...statePrivate.view, hand: [42] },
      }).success,
    ).toBe(false);
  });
});

describe('events', () => {
  it('aceita os três eventos do contrato', () => {
    expect(
      eventsMessageSchema.safeParse({
        type: 'events',
        matchId: 'm1',
        version: 2,
        events: [
          { type: 'card_played', playerId: 'p1', cardId: 'c1' },
          { type: 'turn_changed', playerId: 'p2' },
          { type: 'match_finished', result: { outcome: 'draw' } },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejeita evento desconhecido', () => {
    expect(
      eventsMessageSchema.safeParse({
        type: 'events',
        matchId: 'm1',
        version: 2,
        events: [{ type: 'card_drawn', playerId: 'p1' }],
      }).success,
    ).toBe(false);
  });
});

describe('error', () => {
  it('aceita código estável', () => {
    expect(
      errorMessageSchema.safeParse({ type: 'error', code: 'stale_state', message: 'Versão antiga' })
        .success,
    ).toBe(true);
  });

  it('rejeita código fora do enum', () => {
    expect(
      errorMessageSchema.safeParse({ type: 'error', code: 'invalid_setup', message: 'Erro' })
        .success,
    ).toBe(false);
  });
});

describe('serverMessageSchema', () => {
  it('aceita todas as mensagens do contrato', () => {
    expect(serverMessageSchema.safeParse(joinAccepted).success).toBe(true);
    expect(serverMessageSchema.safeParse(roomWaiting).success).toBe(true);
    expect(serverMessageSchema.safeParse(statePublic).success).toBe(true);
    expect(serverMessageSchema.safeParse(statePrivate).success).toBe(true);
    expect(
      serverMessageSchema.safeParse({
        type: 'events',
        matchId: 'm1',
        version: 0,
        events: [],
      }).success,
    ).toBe(true);
    expect(
      serverMessageSchema.safeParse({ type: 'error', code: 'internal', message: 'Erro' }).success,
    ).toBe(true);
  });

  it('rejeita type desconhecido', () => {
    expect(serverMessageSchema.safeParse({ type: 'room_created' }).success).toBe(false);
  });
});
