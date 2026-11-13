import { describe, expect, it } from 'vitest';

import {
  PATIENCE_VALUES,
  type PatienceCard,
  type PatienceState,
  type PatienceSuit,
} from '@cartas-na-mesa/core';

import { findCompleteRuns } from './sequences';

const SUITS: readonly PatienceSuit[] = ['espada', 'copa'];

/** K→A alternando preto/vermelho (espada, copa, espada…). */
function kingToAce(): PatienceCard[] {
  return [...PATIENCE_VALUES].reverse().map((value, i) => {
    const suit = SUITS[i % 2] as PatienceSuit;
    return { id: `${value}-${suit}`, value, suit };
  });
}

function state(tableau: PatienceCard[][], faceDown: number[]): PatienceState {
  return {
    status: 'playing',
    currentTurnPlayerId: 'player-1',
    stock: [],
    waste: [],
    tableau,
    faceDown,
    foundations: [[], [], [], []],
    moves: 0,
  };
}

describe('findCompleteRuns', () => {
  it('acha o K→A completo, mesmo com cartas viradas embaixo', () => {
    const hidden: PatienceCard = { id: '9-paus', value: '9', suit: 'paus' };
    const s = state([[], [hidden, ...kingToAce()], [], [], [], [], []], [0, 1, 0, 0, 0, 0, 0]);
    expect(findCompleteRuns(s)).toEqual([{ column: 1, start: 1, key: '1:K-espada' }]);
  });

  it('ignora sequência incompleta ou com o Rei ainda virado para baixo', () => {
    const incomplete = kingToAce().slice(0, 12);
    expect(
      findCompleteRuns(state([incomplete, [], [], [], [], [], []], [0, 0, 0, 0, 0, 0, 0])),
    ).toEqual([]);
    expect(
      findCompleteRuns(state([kingToAce(), [], [], [], [], [], []], [1, 0, 0, 0, 0, 0, 0])),
    ).toEqual([]);
  });

  it('ignora sequência de cores repetidas', () => {
    const wrong = kingToAce().map((c) => ({ ...c, suit: 'espada' as const, id: `${c.value}-x` }));
    expect(findCompleteRuns(state([wrong, [], [], [], [], [], []], [0, 0, 0, 0, 0, 0, 0]))).toEqual(
      [],
    );
  });
});
