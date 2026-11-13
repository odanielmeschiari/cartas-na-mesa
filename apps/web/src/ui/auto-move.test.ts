import { describe, expect, it } from 'vitest';

import {
  patienceGame,
  type PatienceCard,
  type PatienceState,
  type PatienceSuit,
  type PatienceValue,
} from '@cartas-na-mesa/core';

import { findAutoMove } from './auto-move';

function card(value: PatienceValue, suit: PatienceSuit): PatienceCard {
  return { id: `${value}-${suit}`, value, suit };
}

/** Mesa vazia; cada teste preenche só o que precisa. */
function state(overrides: Partial<PatienceState>): PatienceState {
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

describe('findAutoMove', () => {
  it('manda o descarte para a fundação quando cabe', () => {
    const s = state({ waste: [card('A', 'ouro')] });
    expect(findAutoMove(s, { kind: 'waste' })).toEqual({ type: 'waste_to_foundation' });
  });

  it('manda o descarte para uma coluna quando não cabe na fundação', () => {
    const s = state({
      waste: [card('5', 'copa')],
      tableau: [[], [], [card('6', 'paus')], [], [], [], []],
    });
    expect(findAutoMove(s, { kind: 'waste' })).toEqual({ type: 'waste_to_tableau', toColumn: 2 });
  });

  it('prefere a fundação à coluna', () => {
    const s = state({
      waste: [card('A', 'ouro')],
      tableau: [[card('2', 'paus')], [], [], [], [], [], []],
    });
    expect(findAutoMove(s, { kind: 'waste' })).toEqual({ type: 'waste_to_foundation' });
  });

  it('prefere uma coluna com cartas a uma vazia para o Rei', () => {
    const s = state({ waste: [card('K', 'espada')] });
    expect(findAutoMove(s, { kind: 'waste' })).toEqual({ type: 'waste_to_tableau', toColumn: 0 });
  });

  it('manda a carta do topo da coluna para a fundação', () => {
    const s = state({ tableau: [[card('A', 'copa')], [], [], [], [], [], []] });
    expect(findAutoMove(s, { kind: 'tableau', column: 0, cardId: 'A-copa' })).toEqual({
      type: 'tableau_to_foundation',
      fromColumn: 0,
    });
  });

  it('move uma sequência inteira para a coluna certa', () => {
    const s = state({
      tableau: [[card('7', 'ouro'), card('6', 'paus')], [card('8', 'espada')], [], [], [], [], []],
    });
    expect(findAutoMove(s, { kind: 'tableau', column: 0, cardId: '7-ouro' })).toEqual({
      type: 'tableau_to_tableau',
      fromColumn: 0,
      toColumn: 1,
      cardId: '7-ouro',
    });
  });

  it('não sobe para a fundação uma carta que não está no topo', () => {
    const s = state({ tableau: [[card('A', 'copa'), card('9', 'paus')], [], [], [], [], [], []] });
    expect(findAutoMove(s, { kind: 'tableau', column: 0, cardId: 'A-copa' })).toBeNull();
  });

  it('devolve null quando não há posição para a carta', () => {
    const s = state({ tableau: [[card('9', 'paus')], [card('9', 'copa')], [], [], [], [], []] });
    expect(findAutoMove(s, { kind: 'tableau', column: 0, cardId: '9-paus' })).toBeNull();
  });

  it('só devolve jogadas que o núcleo aceita', () => {
    const s = state({
      waste: [card('5', 'copa')],
      tableau: [[card('6', 'paus')], [], [], [], [], [], []],
    });
    const payload = findAutoMove(s, { kind: 'waste' });
    expect(payload).not.toBeNull();
    if (payload !== null) {
      expect(patienceGame.applyAction(s, { playerId: 'player-1', payload }).ok).toBe(true);
    }
  });
});
