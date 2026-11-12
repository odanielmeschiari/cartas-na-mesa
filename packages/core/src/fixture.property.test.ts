import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createSeededRng, fixtureGame, type PlayerSeed } from './index';

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
type EngineErrorCode = 'not_your_turn' | 'card_not_in_hand' | 'game_finished';

const PROPERTY_OPTIONS = { seed: 20261112, numRuns: 100 } as const;

const scenarioArbitrary = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  choices: fc.array(fc.nat({ max: 1 }), { maxLength: 8 }),
});

const invalidActionArbitrary = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  choices: fc.array(fc.nat({ max: 1 }), { maxLength: 8 }),
  playerIndex: fc.nat({ max: 1 }),
  cardId: fc.constantFrom('c1', 'c2', 'c3', 'c4', 'cX'),
});

function reachableStates(seed: number, choices: readonly number[]): FixtureState[] {
  const initial = fixtureGame.createInitialState(PLAYERS, createSeededRng(seed));
  const states: FixtureState[] = [initial];
  let state = initial;

  for (const choice of choices) {
    const playerId = fixtureGame.publicView(state).currentTurnPlayerId;
    if (playerId === null) {
      break;
    }
    const actions = fixtureGame.legalActions(state, playerId);
    expect(actions.length).toBeGreaterThan(0);
    const action = actions.at(choice % actions.length);
    if (action === undefined) {
      throw new Error('ação legal ausente durante a geração do estado');
    }
    const result = fixtureGame.applyAction(state, { playerId, payload: action });
    if (!result.ok) {
      throw new Error(`ação legal rejeitada: ${result.error.code}`);
    }
    state = result.state;
    states.push(state);
  }

  return states;
}

// A observação cobre estado público e ambas as visões privadas, ou seja, todo o estado lógico.
function observe(state: FixtureState) {
  return {
    publicView: fixtureGame.publicView(state),
    handA: [...fixtureGame.viewFor(state, PLAYER_A.playerId).hand],
    handB: [...fixtureGame.viewFor(state, PLAYER_B.playerId).hand],
  };
}

function expectCardsConserved(state: FixtureState): void {
  const view = fixtureGame.publicView(state);
  const handA = fixtureGame.viewFor(state, PLAYER_A.playerId).hand;
  const handB = fixtureGame.viewFor(state, PLAYER_B.playerId).hand;

  expect(view.handSizes).toEqual([
    { playerId: PLAYER_A.playerId, count: handA.length },
    { playerId: PLAYER_B.playerId, count: handB.length },
  ]);
  expect(handA.length + handB.length + view.table.length).toBe(4);
  expect(handA.some((cardId) => handB.includes(cardId))).toBe(false);

  const allCards = [...handA, ...handB, ...view.table.map((entry) => entry.cardId)];
  expect(new Set(allCards).size).toBe(4);
}

function invalidReason(
  state: FixtureState,
  playerId: string,
  cardId: string,
): EngineErrorCode | null {
  const view = fixtureGame.publicView(state);
  if (view.status === 'finished') {
    return 'game_finished';
  }
  if (view.currentTurnPlayerId !== playerId) {
    return 'not_your_turn';
  }
  return fixtureGame.viewFor(state, playerId).hand.includes(cardId) ? null : 'card_not_in_hand';
}

describe('invariantes do fixture', () => {
  it('conserva as cartas em qualquer estado alcançável', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ seed, choices }) => {
        for (const state of reachableStates(seed, choices)) {
          expectCardsConserved(state);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('tem turno nulo exatamente quando terminou, com resultado coerente', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ seed, choices }) => {
        for (const state of reachableStates(seed, choices)) {
          const view = fixtureGame.publicView(state);
          const result = fixtureGame.resultOf(state);

          if (view.status === 'finished') {
            expect(view.currentTurnPlayerId).toBeNull();
            expect(view.result).toEqual({ outcome: 'draw' });
            expect(result).toEqual({ outcome: 'draw' });
          } else {
            expect(view.currentTurnPlayerId).not.toBeNull();
            expect(view.result).toBeNull();
            expect(result).toBeNull();
          }
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('aceita toda ação legal, sem lançar, e conserva as cartas', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ seed, choices }) => {
        for (const state of reachableStates(seed, choices)) {
          const playerId = fixtureGame.publicView(state).currentTurnPlayerId;
          if (playerId === null) {
            continue;
          }
          for (const action of fixtureGame.legalActions(state, playerId)) {
            const result = fixtureGame.applyAction(state, { playerId, payload: action });
            expect(result.ok).toBe(true);
            if (result.ok) {
              expectCardsConserved(result.state);
            }
          }
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('rejeita qualquer ação inválida sem alterar o estado', () => {
    fc.assert(
      fc.property(invalidActionArbitrary, ({ seed, choices, playerIndex, cardId }) => {
        const states = reachableStates(seed, choices);
        const state = states.at(-1);
        const player = PLAYERS[playerIndex];
        if (state === undefined || player === undefined) {
          return;
        }

        const reason = invalidReason(state, player.playerId, cardId);
        fc.pre(reason !== null);
        if (reason === null) {
          return;
        }

        const snapshot = observe(state);
        const result = fixtureGame.applyAction(state, {
          playerId: player.playerId,
          payload: { type: 'play_card', cardId },
        });

        expect(result.ok).toBe(false);
        if (result.ok) {
          return;
        }
        expect(result.error.code).toBe(reason);
        expect(observe(state)).toEqual(snapshot);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it('não expõe na projeção pública cartas que estejam só em mãos', () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ seed, choices }) => {
        for (const state of reachableStates(seed, choices)) {
          const view = fixtureGame.publicView(state);
          const serialized = JSON.stringify(view);
          const tableCardIds = new Set(view.table.map((entry) => entry.cardId));
          const handA = fixtureGame.viewFor(state, PLAYER_A.playerId).hand;
          const handB = fixtureGame.viewFor(state, PLAYER_B.playerId).hand;

          expect(Object.hasOwn(view, 'hand')).toBe(false);
          for (const cardId of [...handA, ...handB]) {
            if (!tableCardIds.has(cardId)) {
              expect(serialized).not.toContain(cardId);
            }
          }
        }
      }),
      PROPERTY_OPTIONS,
    );
  });
});
