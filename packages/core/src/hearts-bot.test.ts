import { describe, expect, it } from 'vitest';

import { chooseEasyAction } from './hearts-bot';
import {
  heartsGame,
  startNextHand,
  type HeartsActionPayload,
  type HeartsPrivateView,
  type HeartsPublicView,
  type HeartsState,
} from './hearts-game';
import { createDeck } from './patience';
import { createSeededRng } from './rng';

const DECK = createDeck();
const pick = (...ids: string[]) => ids.map((id) => DECK.find((card) => card.id === id)!);

function table(trickIds: string[] = []): HeartsPublicView {
  return {
    gameId: 'hearts',
    phase: 'playing',
    handIndex: 0,
    passDirection: 'none',
    currentTurnPlayerId: 'me',
    handSizes: [],
    passConfirmed: [],
    trick: trickIds.map((cardId, i) => ({ playerId: `p${i}`, cardId })),
    heartsBroken: true,
    totals: [],
    lastHandPoints: null,
  };
}

/** Visão do bot em que todas as cartas da mão são jogáveis, para isolar a heurística. */
function playView(handIds: string[]): HeartsPrivateView {
  return {
    playerId: 'me',
    hand: pick(...handIds),
    passSelection: null,
    legalActions: handIds.map((cardId) => ({ type: 'play_card', cardId })),
  };
}

const played = (action: HeartsActionPayload | null) =>
  action?.type === 'play_card' ? action.cardId : null;

describe('bot fácil — passe', () => {
  const passView = (handIds: string[]): HeartsPrivateView => ({
    playerId: 'me',
    hand: pick(...handIds),
    passSelection: null,
    legalActions: [{ type: 'pass_cards', cardIds: handIds.slice(0, 3) }],
  });

  it('passa a dama de espadas e as copas mais altas', () => {
    const view = passView(['e-Q', 'c-A', 'c-K', 'p-2', 'o-3', 'p-4']);
    const action = chooseEasyAction(view, table());
    expect(action?.type === 'pass_cards' ? [...action.cardIds].sort() : null).toEqual([
      'c-A',
      'c-K',
      'e-Q',
    ]);
  });

  it('passa Ás e Rei de espadas quando não tem a dama', () => {
    const view = passView(['e-A', 'e-K', 'o-2', 'p-3', 'p-4', 'o-5', 'c-2']);
    const action = chooseEasyAction(view, table());
    expect(action?.type === 'pass_cards' ? action.cardIds : null).toContain('e-A');
    expect(action?.type === 'pass_cards' ? action.cardIds : null).toContain('e-K');
  });
});

describe('bot fácil — jogo', () => {
  it('abre com a carta mais baixa, deixando as copas por último', () => {
    expect(played(chooseEasyAction(playView(['c-2', 'o-9', 'p-7']), table()))).toBe('p-7');
  });

  it('abre com copa só se for tudo que tem', () => {
    expect(played(chooseEasyAction(playView(['c-9', 'c-4']), table()))).toBe('c-4');
  });

  it('cobre por baixo: joga a maior carta que não ganha o truque', () => {
    const view = playView(['o-3', 'o-9', 'o-Q']);
    expect(played(chooseEasyAction(view, table(['o-J'])))).toBe('o-9');
  });

  it('forçado a ganhar, joga a menor do naipe', () => {
    const view = playView(['o-K', 'o-A']);
    expect(played(chooseEasyAction(view, table(['o-5', 'c-3'])))).toBe('o-K');
  });

  it('última jogada em truque sem pontos: ganha com a maior', () => {
    const view = playView(['o-K', 'o-A']);
    expect(played(chooseEasyAction(view, table(['o-5', 'o-6', 'o-7'])))).toBe('o-A');
  });

  it('sem o naipe, descarta a dama de espadas primeiro', () => {
    const view = playView(['e-Q', 'c-A', 'p-9']);
    expect(played(chooseEasyAction(view, table(['o-5'])))).toBe('e-Q');
  });

  it('sem o naipe e sem a dama, descarta a copa mais alta', () => {
    const view = playView(['c-9', 'c-K', 'p-9']);
    expect(played(chooseEasyAction(view, table(['o-5'])))).toBe('c-K');
  });

  it('só escolhe entre as cartas legais e devolve null sem ação legal', () => {
    const view: HeartsPrivateView = {
      ...playView(['o-2', 'p-9']),
      legalActions: [{ type: 'play_card', cardId: 'p-9' }],
    };
    expect(played(chooseEasyAction(view, table()))).toBe('p-9');
    expect(chooseEasyAction({ ...view, legalActions: [] }, table())).toBeNull();
  });
});

describe('bot fácil — partida completa', () => {
  it.each([1, 2, 3, 4, 5])('seed %i: 4 bots terminam a partida só com jogadas aceitas', (seed) => {
    const players = ['a', 'b', 'c', 'd'].map((playerId, seatIndex) => ({
      playerId,
      seatIndex,
      nickname: playerId,
      avatarId: null,
    }));
    const rng = createSeededRng(seed * 31);
    let state: HeartsState = heartsGame.createInitialState(players, createSeededRng(seed));
    for (let guard = 0; guard < 8000 && state.phase !== 'finished'; guard += 1) {
      if (state.phase === 'hand_over') {
        state = startNextHand(state, rng);
        continue;
      }
      const publicView = heartsGame.publicView(state);
      const move = state.playerIds
        .map((playerId) => ({
          playerId,
          payload: chooseEasyAction(heartsGame.viewFor(state, playerId), publicView),
        }))
        .find((entry) => entry.payload !== null);
      if (move === undefined || move.payload === null) throw new Error('nenhum bot tem ação');
      const { playerId, payload } = { playerId: move.playerId, payload: move.payload };
      const result = heartsGame.applyAction(state, { playerId, payload });
      if (!result.ok) throw new Error(`bot fez jogada recusada: ${result.error.message}`);
      state = result.state;
    }
    expect(state.phase).toBe('finished');
    expect(heartsGame.resultOf(state)?.winners).toHaveLength(1);
  });
});
