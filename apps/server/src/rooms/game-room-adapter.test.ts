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
    expect(fixtureAdapter.advance).toBeUndefined();
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

  it('o avanço distribui a próxima mão só depois do fim da mão', () => {
    const { game, advance, chooseBotAction } = heartsAdapter;
    if (advance === undefined || chooseBotAction === undefined) {
      throw new Error('O adaptador do Copas deveria ter avanço e bot.');
    }

    let state = game.createInitialState(heartsPlayers, createSeededRng(7));
    expect(advance.isPending(state)).toBe(false);

    // Os quatro assentos jogam com o bot até a mão acabar: 4 passes + 52 jogadas.
    for (let step = 0; state.phase !== 'hand_over'; step += 1) {
      if (step >= 200) {
        throw new Error('A mão não terminou em 200 passos.');
      }
      const current = state;
      const move = heartsPlayers.flatMap(({ playerId }) => {
        const action = chooseBotAction(game.viewFor(current, playerId), game.publicView(current));
        return action === null ? [] : [{ playerId, payload: action }];
      })[0];
      if (move === undefined) {
        throw new Error('Nenhum assento tem ação legal, mas a mão não terminou.');
      }
      const result = game.applyAction(current, move);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      state = result.state;
    }

    expect(advance.isPending(state)).toBe(true);

    const next = advance.apply(state, createSeededRng(8));
    expect(next.phase).toBe('passing');
    expect(next.handIndex).toBe(1);
    expect(next.totals).toEqual(state.totals);
    expect(next.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(advance.isPending(next)).toBe(false);
  });
});
