import { describe, expect, it } from 'vitest';

import { createSeededRng } from './rng';
import {
  cardColor,
  createDeck,
  patienceGame,
  type PatienceCard,
  type PatienceState,
} from './patience';

const players = [{ playerId: 'p1', seatIndex: 0, nickname: 'Você', avatarId: null }];
const fresh = (seed = 7): PatienceState =>
  patienceGame.createInitialState(players, createSeededRng(seed));
const act = (
  s: PatienceState,
  payload: Parameters<typeof patienceGame.applyAction>[1]['payload'],
) => patienceGame.applyAction(s, { playerId: 'p1', payload });
const card = (suit: PatienceCard['suit'], value: PatienceCard['value']): PatienceCard => ({
  suit,
  value,
  id: `${suit}-${value}`,
});

describe('paciência (Klondike)', () => {
  it('distribui 52 cartas únicas: 28 no tableau, 24 no monte', () => {
    const s = fresh();
    const all = [...s.stock, ...s.tableau.flat()];
    expect(s.stock).toHaveLength(24);
    expect(s.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.faceDown).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
    expect(createDeck()).toHaveLength(52);
  });

  it('ouros e copas são vermelhos; espadas e paus são pretos', () => {
    expect(cardColor(card('ouro', 'A'))).toBe('vermelho');
    expect(cardColor(card('copa', 'A'))).toBe('vermelho');
    expect(cardColor(card('espada', 'A'))).toBe('preto');
    expect(cardColor(card('paus', 'A'))).toBe('preto');
  });

  it('flip_stock move a carta do monte para o topo do descarte e recicla ao esvaziar', () => {
    let s = fresh();
    const top = s.stock[s.stock.length - 1]!;
    const r = act(s, { type: 'flip_stock' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.waste[s.waste.length - 1]).toEqual(top);
    s = { ...s, stock: [] };
    const recycled = act(s, { type: 'flip_stock' });
    expect(recycled.ok && recycled.state.stock.length).toBe(s.waste.length);
  });

  it('move uma sequência e desvira a carta que fica no topo da origem', () => {
    const s: PatienceState = {
      ...fresh(),
      tableau: [
        [card('paus', '9'), card('copa', '5'), card('espada', '4')],
        [card('ouro', '6')],
        [],
        [],
        [],
        [],
        [],
      ],
      faceDown: [1, 0, 0, 0, 0, 0, 0],
    };
    const r = act(s, { type: 'tableau_to_tableau', fromColumn: 0, toColumn: 1, cardId: 'copa-5' });
    // copa 5 (vermelha) não cabe sobre ouro 6 (vermelho)
    expect(r.ok).toBe(false);
    const s2 = { ...s, tableau: [s.tableau[0]!, [card('espada', '6')], ...s.tableau.slice(2)] };
    const ok = act(s2, {
      type: 'tableau_to_tableau',
      fromColumn: 0,
      toColumn: 1,
      cardId: 'copa-5',
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.state.tableau[1]!.map((c) => c.id)).toEqual(['espada-6', 'copa-5', 'espada-4']);
    expect(ok.state.faceDown[0]).toBe(0);
  });

  it('não permite mover cartas viradas para baixo nem Rei fora de coluna vazia', () => {
    const s: PatienceState = {
      ...fresh(),
      tableau: [[card('paus', '9'), card('copa', '5')], [card('ouro', 'K')], [], [], [], [], []],
      faceDown: [1, 0, 0, 0, 0, 0, 0],
    };
    expect(
      act(s, { type: 'tableau_to_tableau', fromColumn: 0, toColumn: 2, cardId: 'paus-9' }).ok,
    ).toBe(false);
    expect(
      act(s, { type: 'tableau_to_tableau', fromColumn: 0, toColumn: 1, cardId: 'copa-5' }).ok,
    ).toBe(false);
  });

  it('só aceita o Ás na fundação vazia e termina com vitória ao completar 52', () => {
    const s = fresh();
    expect(act({ ...s, waste: [card('copa', '2')] }, { type: 'waste_to_foundation' }).ok).toBe(
      false,
    );
    const deck = createDeck();
    const foundations = [0, 1, 2, 3].map((i) => deck.slice(i * 13, i * 13 + 13));
    const last = foundations[3]!.pop()!;
    const almost: PatienceState = {
      ...s,
      stock: [],
      waste: [last],
      tableau: [[], [], [], [], [], [], []],
      faceDown: [0, 0, 0, 0, 0, 0, 0],
      foundations,
    };
    const r = act(almost, { type: 'waste_to_foundation' });
    expect(r.ok && r.state.status).toBe('finished');
    expect(r.ok && patienceGame.resultOf(r.state)).toEqual({ outcome: 'win' });
  });
});
