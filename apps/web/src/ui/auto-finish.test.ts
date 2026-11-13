import { describe, expect, it } from 'vitest';

import {
  PATIENCE_VALUES,
  type PatienceCard,
  type PatienceState,
  type PatienceSuit,
} from '@cartas-na-mesa/core';

import { canAutoFinish, planAutoFinish } from './auto-finish';

function empty(overrides: Partial<PatienceState>): PatienceState {
  return {
    status: 'playing',
    currentTurnPlayerId: 'player-1',
    stock: [],
    waste: [],
    tableau: [[], [], [], [], [], [], []],
    faceDown: [0, 0, 0, 0, 0, 0, 0],
    foundations: [[], [], [], []],
    moves: 0,
    ...overrides,
  };
}

/** Uma coluna K→A que começa em `first` e alterna as cores (naipes de `pair`). */
function run(pair: readonly [PatienceSuit, PatienceSuit]): PatienceCard[] {
  return [...PATIENCE_VALUES].reverse().map((value, i) => {
    const suit = pair[i % 2] as PatienceSuit;
    return { id: `${value}-${suit}`, value, suit };
  });
}

/** Quatro colunas válidas (toda coluna toda virada é uma sequência decrescente alternada). */
function validColumns(): PatienceCard[][] {
  return [
    run(['espada', 'copa']),
    run(['paus', 'ouro']),
    run(['copa', 'espada']),
    run(['ouro', 'paus']),
  ];
}

describe('canAutoFinish', () => {
  it('só libera quando nenhuma coluna tem carta virada para baixo', () => {
    expect(canAutoFinish(empty({}))).toBe(true);
    expect(canAutoFinish(empty({ faceDown: [0, 0, 0, 0, 0, 1, 0] }))).toBe(false);
  });

  it('não libera numa partida já terminada', () => {
    expect(canAutoFinish(empty({ status: 'finished' }))).toBe(false);
  });
});

describe('planAutoFinish', () => {
  it('chega à vitória com tudo na mesa', () => {
    const plan = planAutoFinish(empty({ tableau: [...validColumns(), [], [], []] }));
    expect(plan.completed).toBe(true);
    expect(plan.steps.at(-1)?.status).toBe('finished');
    expect(plan.steps.at(-1)?.foundations.map((p) => p.length)).toEqual([13, 13, 13, 13]);
  });

  it('chega à vitória com monte e descarte ainda cheios', () => {
    // As duas menores cartas de cada coluna vão para o monte/descarte.
    const columns = validColumns();
    const taken = columns.flatMap((col) => col.splice(-2));
    const state = empty({
      stock: taken.slice(0, 5),
      waste: taken.slice(5),
      tableau: [...columns, [], [], []],
    });
    const plan = planAutoFinish(state);
    expect(plan.completed).toBe(true);
    expect(plan.steps.at(-1)?.foundations.map((p) => p.length)).toEqual([13, 13, 13, 13]);
  });

  it('sobe uma carta por passo, sem repetir estados', () => {
    const plan = planAutoFinish(empty({ tableau: [...validColumns(), [], [], []] }));
    const counts = plan.steps.map((s) => s.foundations.reduce((n, p) => n + p.length, 0));
    expect(counts).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
  });
});
