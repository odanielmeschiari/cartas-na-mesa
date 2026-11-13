import { createSeededRng, type PlayerSeed } from '@cartas-na-mesa/core';
import { describe, expect, it } from 'vitest';

import { fixtureAdapter, heartsAdapter } from './game-room-adapter';

const heartsPlayers: PlayerSeed[] = ['ana', 'bot-1', 'bot-2', 'bot-3'].map((playerId, seatIndex) => ({
  playerId,
  seatIndex,
  nickname: playerId,
  avatarId: null,
}));

describe('fixtureAdapter', () => {
  it('liga o fixture sem bots', () => {
    expect(fixtureAdapter.game.id).toBe('fixture');
    expect(fixtureAdapter.fillWithBots).toBe(false);
    expect(fixtureAdapter.chooseBotAction).toBeUndefined();
  });

  it('o schema da ação só aceita ações do fixture', () => {
    expect(fixtureAdapter.actionSchema.safeParse({ type: 'play_card', cardId: 'c1' }).success).toBe(
      true,
    );
    expect(
      fixtureAdapter.actionSchema.safeParse({ type: 'pass_cards', cardIds: ['a', 'b', 'c'] })
        .success,
    ).toBe(false);
  });
});

describe('heartsAdapter', () => {
  it('liga o Copas com bots nos assentos vagos', () => {
    expect(heartsAdapter.game.id).toBe('hearts');
    expect(heartsAdapter.game.playerCount).toEqual({ min: 4, max: 4 });
    expect(heartsAdapter.fillWithBots).toBe(true);
  });

  it('o schema da ação aceita o passe e recusa campo injetado', () => {
    const pass = { type: 'pass_cards', cardIds: ['a', 'b', 'c'] };
    expect(heartsAdapter.actionSchema.safeParse(pass).success).toBe(true);
    expect(
      heartsAdapter.actionSchema.safeParse({ type: 'play_card', cardId: 'a', playerId: 'x' })
        .success,
    ).toBe(false);
  });

  it('o bot escolhe uma ação legal usando só a visão do próprio assento', () => {
    const { game, chooseBotAction } = heartsAdapter;
    if (chooseBotAction === undefined) {
      throw new Error('O adaptador do Copas deveria ter bot.');
    }
    const state = game.createInitialState(heartsPlayers, createSeededRng(7));
    const own = game.viewFor(state, 'bot-1');
    const action = chooseBotAction(own, game.publicView(state));
    if (action === null) {
      throw new Error('O bot deveria ter uma ação na fase de passe.');
    }
    // O passe aceita as 3 cartas em qualquer ordem; o motor é quem decide a legalidade.
    const result = game.applyAction(state, { playerId: 'bot-1', payload: action });
    expect(result.ok).toBe(true);
  });

  it('a visão pública do adaptador passa no schema de rede do Copas', () => {
    const state = heartsAdapter.game.createInitialState(heartsPlayers, createSeededRng(7));
    const message = {
      type: 'state_public',
      matchId: 'm1',
      roomCode: 'ABCD',
      version: 0,
      seats: heartsPlayers.map((player) => ({
        ...player,
        kind: player.playerId === 'ana' ? 'human' : 'bot',
        connected: true,
      })),
      game: heartsAdapter.game.publicView(state),
    };
    expect(heartsAdapter.messages.statePublic.safeParse(message).success).toBe(true);
  });
});
