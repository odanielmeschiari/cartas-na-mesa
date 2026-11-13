import { describe, expect, it } from 'vitest';

import { UnknownPlayerError } from './game-definition';
import { heartsGame, startNextHand, type HeartsState } from './hearts-game';
import { createSeededRng } from './rng';

const players = ['ana', 'bia', 'caio', 'duda'].map((playerId, seatIndex) => ({
  playerId,
  seatIndex,
  nickname: playerId,
  avatarId: null,
}));
const fresh = (seed = 11): HeartsState =>
  heartsGame.createInitialState(players, createSeededRng(seed));

const act = (
  state: HeartsState,
  playerId: string,
  payload: Parameters<typeof heartsGame.applyAction>[1]['payload'],
) => heartsGame.applyAction(state, { playerId, payload });

function must(result: ReturnType<typeof act>): HeartsState {
  if (!result.ok) throw new Error(`ação recusada: ${result.error.message}`);
  return result.state;
}

/** Faz a primeira ação legal de quem tiver uma; avança a partida um passo. */
function step(state: HeartsState): HeartsState {
  for (const playerId of state.playerIds) {
    const payload = heartsGame.legalActions(state, playerId)[0];
    if (payload !== undefined) return must(act(state, playerId, payload));
  }
  throw new Error('nenhum jogador tem ação legal');
}

function passAll(state: HeartsState): HeartsState {
  let current = state;
  for (const playerId of state.playerIds) {
    const payload = heartsGame.legalActions(current, playerId)[0];
    if (payload === undefined) throw new Error('sem passe legal');
    current = must(act(current, playerId, payload));
  }
  return current;
}

describe('copas — motor: início', () => {
  it('distribui 13 cartas por jogador e começa pelo passe à esquerda', () => {
    const s = fresh();
    expect(s.phase).toBe('passing');
    expect(s.passDirection).toBe('left');
    expect(s.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(heartsGame.publicView(s).currentTurnPlayerId).toBeNull();
  });

  it('é determinístico para a mesma seed', () => {
    expect(fresh(5)).toEqual(fresh(5));
  });

  it('recusa mesas que não tenham 4 jogadores em assentos 0 a 3', () => {
    const rng = createSeededRng(1);
    expect(() => heartsGame.createInitialState(players.slice(0, 3), rng)).toThrow();
    const broken = players.map((p, i) => (i === 3 ? { ...p, seatIndex: 7 } : p));
    expect(() => heartsGame.createInitialState(broken, rng)).toThrow();
  });
});

describe('copas — motor: passe', () => {
  it('valida o passe: 3 cartas diferentes, da própria mão, uma vez só', () => {
    const s = fresh();
    const [a, b, c] = s.hands[0]!.map((card) => card.id);
    const foreign = s.hands[1]![0]!.id;
    const code = (payload: Parameters<typeof act>[2]) => {
      const r = act(s, 'ana', payload);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ type: 'pass_cards', cardIds: [a!, b!] })).toBe('invalid_setup');
    expect(code({ type: 'pass_cards', cardIds: [a!, a!, b!] })).toBe('invalid_setup');
    expect(code({ type: 'pass_cards', cardIds: [a!, b!, foreign] })).toBe('card_not_in_hand');
    const once = must(act(s, 'ana', { type: 'pass_cards', cardIds: [a!, b!, c!] }));
    const again = act(once, 'ana', { type: 'pass_cards', cardIds: [a!, b!, c!] });
    expect(again.ok).toBe(false);
  });

  it('não permite jogar carta durante o passe', () => {
    const s = fresh();
    const r = act(s, 'ana', { type: 'play_card', cardId: s.hands[0]![0]!.id });
    expect(r.ok ? 'ok' : r.error.code).toBe('not_your_turn');
  });

  it('troca as cartas só depois dos 4 e entrega ao assento da esquerda', () => {
    const s = fresh();
    const chosen = s.hands.map((hand) => hand.slice(0, 3).map((card) => card.id));
    let current = s;
    players.forEach((p, seat) => {
      current = must(act(current, p.playerId, { type: 'pass_cards', cardIds: chosen[seat]! }));
      if (seat < 3) expect(current.phase).toBe('passing');
    });
    expect(current.phase).toBe('playing');
    expect(current.hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    const bia = current.hands[1]!.map((card) => card.id);
    expect(chosen[0]!.every((id) => bia.includes(id))).toBe(true);
    expect(chosen[1]!.some((id) => bia.includes(id))).toBe(false);
  });

  it('o passe é oculto: visão pública e eventos não revelam cartas escolhidas', () => {
    const s = fresh();
    const ids = s.hands[0]!.slice(0, 3).map((card) => card.id);
    const r = act(s, 'ana', { type: 'pass_cards', cardIds: ids });
    if (!r.ok) throw new Error('recusado');
    const publicJson = JSON.stringify(heartsGame.publicView(r.state));
    const eventsJson = JSON.stringify(r.events);
    for (const id of ids) {
      expect(publicJson.includes(`"${id}"`)).toBe(false);
      expect(eventsJson.includes(`"${id}"`)).toBe(false);
    }
    expect(heartsGame.viewFor(r.state, 'ana').passSelection).toEqual(ids);
    expect(heartsGame.viewFor(r.state, 'bia').passSelection).toBeNull();
  });
});

describe('copas — motor: jogo', () => {
  it('abre quem tem o 2 de paus e só ele tem ação legal', () => {
    const s = passAll(fresh());
    expect(s.phase).toBe('playing');
    const turn = s.currentTurnSeat!;
    expect(s.hands[turn]!.some((c) => c.suit === 'paus' && c.value === '2')).toBe(true);
    const legal = heartsGame.legalActions(s, s.playerIds[turn]!);
    expect(legal).toHaveLength(1);
    const others = s.playerIds.filter((_, seat) => seat !== turn);
    expect(others.every((id) => heartsGame.legalActions(s, id).length === 0)).toBe(true);
  });

  it('recusa fora do turno e jogada ilegal', () => {
    const s = passAll(fresh());
    const turn = s.currentTurnSeat!;
    const other = s.playerIds[(turn + 1) % 4]!;
    const out = act(s, other, { type: 'play_card', cardId: s.hands[(turn + 1) % 4]![0]!.id });
    expect(out.ok ? 'ok' : out.error.code).toBe('not_your_turn');
    const notTwo = s.hands[turn]!.find((c) => !(c.suit === 'paus' && c.value === '2'))!;
    const illegal = act(s, s.playerIds[turn]!, { type: 'play_card', cardId: notTwo.id });
    expect(illegal.ok ? 'ok' : illegal.error.code).toBe('invalid_setup');
    const missing = act(s, s.playerIds[turn]!, { type: 'play_card', cardId: 'inexistente' });
    expect(missing.ok ? 'ok' : missing.error.code).toBe('card_not_in_hand');
  });

  it('visão privada de quem não pertence à partida falha', () => {
    expect(() => heartsGame.viewFor(fresh(), 'intruso')).toThrow(UnknownPlayerError);
  });

  it('uma mão completa soma 26 pontos (ou 78 ao virar a lua) e termina em hand_over', () => {
    let s = passAll(fresh(3));
    while (s.phase === 'playing') s = step(s);
    expect(s.phase).toBe('hand_over');
    expect(s.hands.every((hand) => hand.length === 0)).toBe(true);
    const total = s.totals.reduce((a, b) => a + b, 0);
    expect([26, 78]).toContain(total);
    expect(heartsGame.resultOf(s)).toBeNull();
  });

  it('startNextHand só vale em hand_over e passa a direção para a direita', () => {
    expect(() => startNextHand(fresh(), createSeededRng(2))).toThrow();
    let s = passAll(fresh(3));
    while (s.phase === 'playing') s = step(s);
    const totals = s.totals;
    const next = startNextHand(s, createSeededRng(9));
    expect(next.handIndex).toBe(1);
    expect(next.passDirection).toBe('right');
    expect(next.phase).toBe('passing');
    expect(next.totals).toEqual(totals);
  });
});

describe('copas — motor: partida completa', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: termina com vencedor de menor total', (seed) => {
    const rng = createSeededRng(seed * 101);
    let s = fresh(seed);
    for (let guard = 0; guard < 5000 && s.phase !== 'finished'; guard += 1) {
      if (s.phase === 'hand_over') {
        s = startNextHand(s, rng);
        if (s.passDirection === 'none') expect(s.phase).toBe('playing');
      } else {
        s = step(s);
      }
    }
    expect(s.phase).toBe('finished');
    const result = heartsGame.resultOf(s);
    expect(result).not.toBeNull();
    expect(Math.max(...s.totals)).toBeGreaterThanOrEqual(100);
    const lowest = Math.min(...s.totals);
    expect(result!.winners).toHaveLength(1);
    expect(s.totals[s.playerIds.indexOf(result!.winners[0]!)]).toBe(lowest);
    const done = act(s, 'ana', { type: 'play_card', cardId: 'x' });
    expect(done.ok ? 'ok' : done.error.code).toBe('game_finished');
  });
});
