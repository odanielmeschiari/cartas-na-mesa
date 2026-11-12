import { describe, expect, it } from 'vitest';

import {
  InvalidSetupError,
  UnknownPlayerError,
  createSeededRng,
  fixtureGame,
  type PlayerSeed,
} from './index';

const PLAYER_A = {
  playerId: 'player-a',
  seatIndex: 0,
  nickname: 'Ana',
  avatarId: null,
} as const satisfies PlayerSeed;

const PLAYER_B = {
  playerId: 'player-b',
  seatIndex: 1,
  nickname: 'Bia',
  avatarId: 'avatar-1',
} as const satisfies PlayerSeed;

const PLAYERS: readonly PlayerSeed[] = [PLAYER_A, PLAYER_B];

type FixtureState = ReturnType<typeof fixtureGame.createInitialState>;

function createState(seed = 1): FixtureState {
  return fixtureGame.createInitialState(PLAYERS, createSeededRng(seed));
}

function handOf(state: FixtureState, playerId: string): readonly string[] {
  return fixtureGame.viewFor(state, playerId).hand;
}

// A observação cobre estado público e ambas as visões privadas, ou seja, todo o estado lógico.
function observe(state: FixtureState) {
  return {
    publicView: fixtureGame.publicView(state),
    handA: [...handOf(state, 'player-a')],
    handB: [...handOf(state, 'player-b')],
  };
}

function play(state: FixtureState, playerId: string, cardId: string) {
  return fixtureGame.applyAction(state, { playerId, payload: { type: 'play_card', cardId } });
}

function playOk(state: FixtureState, playerId: string, cardId: string) {
  const result = play(state, playerId, cardId);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`esperava ação aceita, recebeu ${result.error.code}`);
  }
  return result;
}

function expectRejection(
  state: FixtureState,
  playerId: string,
  cardId: string,
  code: 'not_your_turn' | 'card_not_in_hand' | 'game_finished',
): void {
  const snapshot = observe(state);
  const result = play(state, playerId, cardId);

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('esperava uma ação rejeitada');
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message.length).toBeGreaterThan(0);
  expect('state' in result).toBe(false);
  expect(observe(state)).toEqual(snapshot);
}

describe('fixtureGame', () => {
  it('declara id e contagem de jogadores do contrato', () => {
    expect(fixtureGame.id).toBe('fixture');
    expect(fixtureGame.playerCount).toEqual({ min: 2, max: 2 });
  });

  it('produz o mesmo estado inicial para a mesma seed', () => {
    const first = createState(42);
    const second = createState(42);

    expect(fixtureGame.publicView(first)).toEqual(fixtureGame.publicView(second));
    expect(handOf(first, 'player-a')).toEqual(handOf(second, 'player-a'));
    expect(handOf(first, 'player-b')).toEqual(handOf(second, 'player-b'));
  });

  it('produz distribuições diferentes para seeds diferentes', () => {
    const first = handOf(createState(1), 'player-a');
    const second = handOf(createState(2), 'player-a');

    expect(first).toEqual(['c3', 'c1']);
    expect(second).toEqual(['c1', 'c4']);
    expect(first).not.toEqual(second);
  });

  it('distribui alternando a partir do assento 0, sem repetir cartas', () => {
    const state = createState(1);
    const handA = handOf(state, 'player-a');
    const handB = handOf(state, 'player-b');

    expect(handA).toEqual(['c3', 'c1']);
    expect(handB).toEqual(['c2', 'c4']);
    expect(handA).toHaveLength(2);
    expect(handB).toHaveLength(2);
    expect([...handA, ...handB].sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(new Set([...handA, ...handB]).size).toBe(4);
    expect(handA.filter((cardId) => handB.includes(cardId))).toEqual([]);
  });

  it('ordena assentos e turno pelo seatIndex, não pela ordem de entrada', () => {
    const state = fixtureGame.createInitialState([PLAYER_B, PLAYER_A], createSeededRng(1));

    expect(fixtureGame.publicView(state).handSizes).toEqual([
      { playerId: 'player-a', count: 2 },
      { playerId: 'player-b', count: 2 },
    ]);
    expect(fixtureGame.publicView(state).currentTurnPlayerId).toBe('player-a');
    expect(handOf(state, 'player-a')).toEqual(['c3', 'c1']);
  });

  it('começa no assento 0, alterna o turno e encerra após 4 jogadas', () => {
    const initial = createState(1);
    expect(fixtureGame.publicView(initial).currentTurnPlayerId).toBe('player-a');
    expect(fixtureGame.resultOf(initial)).toBeNull();

    const first = playOk(initial, 'player-a', 'c3');
    expect(fixtureGame.publicView(first.state).currentTurnPlayerId).toBe('player-b');

    const second = playOk(first.state, 'player-b', 'c2');
    expect(fixtureGame.publicView(second.state).currentTurnPlayerId).toBe('player-a');

    const third = playOk(second.state, 'player-a', 'c1');
    expect(fixtureGame.publicView(third.state).currentTurnPlayerId).toBe('player-b');
    expect(fixtureGame.publicView(third.state).status).toBe('playing');

    const fourth = playOk(third.state, 'player-b', 'c4');
    const finished = fixtureGame.publicView(fourth.state);

    expect(finished.status).toBe('finished');
    expect(finished.currentTurnPlayerId).toBeNull();
    expect(finished.handSizes).toEqual([
      { playerId: 'player-a', count: 0 },
      { playerId: 'player-b', count: 0 },
    ]);
    expect(finished.table).toEqual([
      { playerId: 'player-a', cardId: 'c3' },
      { playerId: 'player-b', cardId: 'c2' },
      { playerId: 'player-a', cardId: 'c1' },
      { playerId: 'player-b', cardId: 'c4' },
    ]);
    expect(finished.result).toEqual({ outcome: 'draw' });
    expect(fixtureGame.resultOf(fourth.state)).toEqual({ outcome: 'draw' });
  });

  it('rejeita ação fora do turno sem alterar o estado', () => {
    expectRejection(createState(1), 'player-b', 'c2', 'not_your_turn');
  });

  it('rejeita carta do oponente e carta inexistente sem alterar o estado', () => {
    const state = createState(1);
    expectRejection(state, 'player-a', 'c2', 'card_not_in_hand');
    expectRejection(state, 'player-a', 'cX', 'card_not_in_hand');
  });

  it('rejeita jogador inexistente sem alterar o estado', () => {
    expectRejection(createState(1), 'ghost', 'c1', 'not_your_turn');
  });

  it('rejeita qualquer ação depois do fim com game_finished', () => {
    const first = playOk(createState(1), 'player-a', 'c3');
    const second = playOk(first.state, 'player-b', 'c2');
    const third = playOk(second.state, 'player-a', 'c1');
    const fourth = playOk(third.state, 'player-b', 'c4');

    expectRejection(fourth.state, 'player-a', 'c3', 'game_finished');
    expectRejection(fourth.state, 'player-b', 'c4', 'game_finished');
  });

  it('não muta o estado recebido ao aplicar uma ação válida', () => {
    const state = createState(1);
    const snapshot = observe(state);

    const result = playOk(state, 'player-a', 'c3');

    expect(observe(state)).toEqual(snapshot);
    expect(result.state).not.toBe(state);
    expect(handOf(state, 'player-a')).toEqual(['c3', 'c1']);
    expect(handOf(result.state, 'player-a')).toEqual(['c1']);
    expect(fixtureGame.publicView(state).table).toEqual([]);
  });

  it('emite eventos na ordem esperada, sem turn_changed na última jogada', () => {
    const first = playOk(createState(1), 'player-a', 'c3');
    expect(first.events).toEqual([
      { type: 'card_played', playerId: 'player-a', cardId: 'c3' },
      { type: 'turn_changed', playerId: 'player-b' },
    ]);

    const second = playOk(first.state, 'player-b', 'c2');
    expect(second.events).toEqual([
      { type: 'card_played', playerId: 'player-b', cardId: 'c2' },
      { type: 'turn_changed', playerId: 'player-a' },
    ]);

    const third = playOk(second.state, 'player-a', 'c1');
    expect(third.events).toEqual([
      { type: 'card_played', playerId: 'player-a', cardId: 'c1' },
      { type: 'turn_changed', playerId: 'player-b' },
    ]);

    const fourth = playOk(third.state, 'player-b', 'c4');
    expect(fourth.events).toEqual([
      { type: 'card_played', playerId: 'player-b', cardId: 'c4' },
      { type: 'match_finished', result: { outcome: 'draw' } },
    ]);
    expect(fourth.events.some((event) => event.type === 'turn_changed')).toBe(false);
  });

  it('não expõe cartas de mão na projeção pública', () => {
    const state = createState(1);
    const view = fixtureGame.publicView(state);

    expect(Object.keys(view).sort()).toEqual([
      'currentTurnPlayerId',
      'gameId',
      'handSizes',
      'result',
      'status',
      'table',
    ]);
    expect(view).not.toHaveProperty('hand');

    const initial = JSON.stringify(view);
    for (const cardId of ['c1', 'c2', 'c3', 'c4']) {
      expect(initial).not.toContain(cardId);
    }

    const afterPlay = playOk(state, 'player-a', 'c3').state;
    const later = JSON.stringify(fixtureGame.publicView(afterPlay));
    expect(later).toContain('c3');
    for (const hiddenCardId of ['c1', 'c2', 'c4']) {
      expect(later).not.toContain(hiddenCardId);
    }
  });

  it('entrega a mão apenas ao dono e legalActions coerentes', () => {
    const state = createState(1);

    expect(fixtureGame.viewFor(state, 'player-a')).toEqual({
      playerId: 'player-a',
      hand: ['c3', 'c1'],
      legalActions: [
        { type: 'play_card', cardId: 'c3' },
        { type: 'play_card', cardId: 'c1' },
      ],
    });
    expect(fixtureGame.viewFor(state, 'player-b')).toEqual({
      playerId: 'player-b',
      hand: ['c2', 'c4'],
      legalActions: [],
    });

    const afterPlay = playOk(state, 'player-a', 'c3').state;
    expect(fixtureGame.viewFor(afterPlay, 'player-b').legalActions).toEqual([
      { type: 'play_card', cardId: 'c2' },
      { type: 'play_card', cardId: 'c4' },
    ]);
  });

  it('devolve legalActions vazio fora do turno, para jogador inexistente e no fim', () => {
    const state = createState(1);
    expect(fixtureGame.legalActions(state, 'player-b')).toEqual([]);
    expect(fixtureGame.legalActions(state, 'ghost')).toEqual([]);

    const first = playOk(state, 'player-a', 'c3');
    const second = playOk(first.state, 'player-b', 'c2');
    const third = playOk(second.state, 'player-a', 'c1');
    const fourth = playOk(third.state, 'player-b', 'c4');

    expect(fixtureGame.legalActions(fourth.state, 'player-a')).toEqual([]);
    expect(fixtureGame.legalActions(fourth.state, 'player-b')).toEqual([]);
  });

  it('lança UnknownPlayerError ao pedir visão de jogador inexistente', () => {
    const state = createState(1);

    expect(() => fixtureGame.viewFor(state, 'ghost')).toThrow(UnknownPlayerError);

    try {
      fixtureGame.viewFor(state, 'ghost');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownPlayerError);
      if (error instanceof UnknownPlayerError) {
        expect(error.code).toBe('unknown_player');
        expect(error.playerId).toBe('ghost');
      }
    }
  });

  it('lança InvalidSetupError com código estável para setup inválido', () => {
    const THIRD_PLAYER: PlayerSeed = {
      playerId: 'player-c',
      seatIndex: 2,
      nickname: 'Cai',
      avatarId: null,
    };
    const cases: readonly { name: string; players: readonly PlayerSeed[] }[] = [
      { name: 'sem jogadores', players: [] },
      { name: 'um jogador', players: [PLAYER_A] },
      { name: 'três jogadores', players: [PLAYER_A, PLAYER_B, THIRD_PLAYER] },
      {
        name: 'assentos duplicados',
        players: [PLAYER_A, { ...PLAYER_B, seatIndex: 0 }],
      },
      {
        name: 'jogadores duplicados',
        players: [PLAYER_A, { ...PLAYER_B, playerId: 'player-a' }],
      },
      {
        name: 'assento fora de 0/1',
        players: [PLAYER_A, { ...PLAYER_B, seatIndex: 2 }],
      },
    ];

    for (const { name, players } of cases) {
      expect(() => fixtureGame.createInitialState(players, createSeededRng(1)), name).toThrow(
        InvalidSetupError,
      );
    }

    try {
      fixtureGame.createInitialState([PLAYER_A], createSeededRng(1));
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSetupError);
      if (error instanceof InvalidSetupError) {
        expect(error.code).toBe('invalid_setup');
      }
    }
  });
});
