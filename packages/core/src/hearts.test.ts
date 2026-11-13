import { describe, expect, it } from 'vitest';

import {
  breaksHearts,
  cardPoints,
  dealHands,
  findOpeningSeat,
  heartsRank,
  legalPlays,
  matchStanding,
  passDirectionFor,
  passTargetSeat,
  scoreHand,
  trickPoints,
  trickWinner,
  type HeartsCard,
  type TrickPlay,
} from './hearts';
import { createDeck } from './patience';
import { createSeededRng } from './rng';

const c = (suit: HeartsCard['suit'], value: HeartsCard['value']): HeartsCard => ({
  suit,
  value,
  id: `${suit}-${value}`,
});
const play = (seat: number, card: HeartsCard): TrickPlay => ({ seat, card });
const ids = (cards: readonly HeartsCard[]) => cards.map((card) => card.id).sort();

describe('copas — cartas e pontos', () => {
  it('o Ás é a carta mais alta', () => {
    expect(heartsRank(c('paus', 'A'))).toBe(14);
    expect(heartsRank(c('paus', 'K'))).toBe(13);
    expect(heartsRank(c('paus', '2'))).toBe(2);
  });

  it('cada copa vale 1, a dama de espadas vale 13 e o resto vale 0; o baralho soma 26', () => {
    expect(cardPoints(c('copa', '5'))).toBe(1);
    expect(cardPoints(c('espada', 'Q'))).toBe(13);
    expect(cardPoints(c('espada', 'K'))).toBe(0);
    expect(cardPoints(c('ouro', 'J'))).toBe(0);
    expect(createDeck().reduce((sum, card) => sum + cardPoints(card), 0)).toBe(26);
  });

  it('só copa quebra as copas', () => {
    expect(breaksHearts(c('copa', '2'))).toBe(true);
    expect(breaksHearts(c('espada', 'Q'))).toBe(false);
  });
});

describe('copas — distribuição e passe', () => {
  it('distribui 13 cartas únicas por assento, de forma determinística', () => {
    const hands = dealHands(createSeededRng(7));
    expect(hands.map((hand) => hand.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(hands.flat().map((card) => card.id)).size).toBe(52);
    expect(dealHands(createSeededRng(7))).toEqual(hands);
    expect(dealHands(createSeededRng(8))).not.toEqual(hands);
  });

  it('a abertura é de quem tem o 2 de paus', () => {
    const hands = dealHands(createSeededRng(3));
    const seat = findOpeningSeat(hands);
    expect(hands[seat]?.some((card) => card.suit === 'paus' && card.value === '2')).toBe(true);
    expect(() => findOpeningSeat([[], [], [], []])).toThrow(RangeError);
  });

  it('o passe alterna esquerda, direita, frente e sem passe', () => {
    expect([0, 1, 2, 3, 4, 5].map(passDirectionFor)).toEqual([
      'left',
      'right',
      'across',
      'none',
      'left',
      'right',
    ]);
    expect(() => passDirectionFor(-1)).toThrow(RangeError);
  });

  it('esquerda é o próximo assento no sentido horário', () => {
    expect(passTargetSeat(0, 'left')).toBe(1);
    expect(passTargetSeat(3, 'left')).toBe(0);
    expect(passTargetSeat(0, 'right')).toBe(3);
    expect(passTargetSeat(1, 'across')).toBe(3);
    expect(passTargetSeat(2, 'none')).toBe(2);
    expect(() => passTargetSeat(4, 'left')).toThrow(RangeError);
  });
});

describe('copas — jogadas legais', () => {
  const hand = [c('paus', '2'), c('paus', '9'), c('copa', '4'), c('espada', 'Q'), c('ouro', '7')];

  it('o primeiro truque é aberto pelo 2 de paus', () => {
    const ctx = { trick: [], isFirstTrick: true, heartsBroken: false };
    expect(legalPlays(hand, ctx)).toEqual([c('paus', '2')]);
    expect(legalPlays([c('ouro', '7')], ctx)).toEqual([]);
  });

  it('não se abre com copa antes de quebrar, salvo mão só de copas', () => {
    const ctx = { trick: [], isFirstTrick: false, heartsBroken: false };
    expect(ids(legalPlays(hand, ctx))).toEqual(
      ids([c('paus', '2'), c('paus', '9'), c('espada', 'Q'), c('ouro', '7')]),
    );
    expect(legalPlays([c('copa', '4'), c('copa', '9')], ctx)).toHaveLength(2);
    expect(legalPlays(hand, { ...ctx, heartsBroken: true })).toHaveLength(5);
  });

  it('a dama de espadas pode abrir o truque antes de quebrar as copas', () => {
    const ctx = { trick: [], isFirstTrick: false, heartsBroken: false };
    expect(legalPlays([c('espada', 'Q'), c('copa', '4')], ctx)).toEqual([c('espada', 'Q')]);
  });

  it('é obrigatório seguir o naipe da abertura', () => {
    const ctx = {
      trick: [play(0, c('paus', 'K'))],
      isFirstTrick: false,
      heartsBroken: false,
    };
    expect(ids(legalPlays(hand, ctx))).toEqual(ids([c('paus', '2'), c('paus', '9')]));
  });

  it('sem o naipe da abertura, qualquer carta serve fora do primeiro truque', () => {
    const ctx = {
      trick: [play(0, c('ouro', 'K'))],
      isFirstTrick: false,
      heartsBroken: false,
    };
    expect(legalPlays([c('copa', '4'), c('espada', 'Q')], ctx)).toHaveLength(2);
  });

  it('no primeiro truque, sem paus, não se descarta copa nem dama de espadas', () => {
    const ctx = {
      trick: [play(0, c('paus', '2'))],
      isFirstTrick: true,
      heartsBroken: false,
    };
    expect(legalPlays([c('copa', '4'), c('espada', 'Q'), c('ouro', '7')], ctx)).toEqual([
      c('ouro', '7'),
    ]);
  });

  it('no primeiro truque, mão só de pontos pode descartar qualquer carta', () => {
    const ctx = {
      trick: [play(0, c('paus', '2'))],
      isFirstTrick: true,
      heartsBroken: false,
    };
    expect(legalPlays([c('copa', '4'), c('espada', 'Q')], ctx)).toHaveLength(2);
  });
});

describe('copas — truques', () => {
  it('vence a maior carta do naipe da abertura; descarte de outro naipe nunca vence', () => {
    const trick = [
      play(2, c('ouro', '9')),
      play(3, c('copa', 'A')),
      play(0, c('ouro', 'Q')),
      play(1, c('ouro', '3')),
    ];
    expect(trickWinner(trick)).toBe(0);
  });

  it('o Ás vence o Rei do mesmo naipe', () => {
    const trick = [
      play(1, c('paus', 'K')),
      play(2, c('paus', 'A')),
      play(3, c('paus', '2')),
      play(0, c('paus', 'Q')),
    ];
    expect(trickWinner(trick)).toBe(2);
  });

  it('exige truque completo', () => {
    expect(() => trickWinner([play(0, c('paus', '2'))])).toThrow(RangeError);
  });

  it('soma os pontos das cartas do truque', () => {
    const trick = [
      play(0, c('copa', '2')),
      play(1, c('copa', '3')),
      play(2, c('espada', 'Q')),
      play(3, c('copa', '4')),
    ];
    expect(trickPoints(trick)).toBe(16);
  });
});

describe('copas — pontuação', () => {
  const deck = createDeck();
  const hearts = deck.filter((card) => card.suit === 'copa');
  const queen = deck.filter((card) => card.suit === 'espada' && card.value === 'Q');
  const rest = deck.filter((card) => card.suit !== 'copa' && !queen.includes(card));

  it('cada assento soma os pontos que capturou', () => {
    const score = scoreHand([hearts.slice(0, 5), [...hearts.slice(5), ...queen], rest, []]);
    expect(score).toEqual({ points: [5, 21, 0, 0], moonShooter: null });
  });

  it('quem leva as 26 pontos faz 0 e os outros fazem 26', () => {
    const score = scoreHand([[], [...hearts, ...queen, ...rest], [], []]);
    expect(score).toEqual({ points: [26, 0, 26, 26], moonShooter: 1 });
  });

  it('rejeita capturas que não somam 26 pontos', () => {
    expect(() => scoreHand([hearts, [], [], []])).toThrow(RangeError);
    expect(() => scoreHand([[], [], []])).toThrow(RangeError);
  });
});

describe('copas — fim da partida', () => {
  it('continua enquanto ninguém chegou a 100', () => {
    expect(matchStanding([99, 40, 12, 3])).toEqual({ finished: false, winners: [] });
  });

  it('ao passar de 100, vence o menor total', () => {
    expect(matchStanding([104, 40, 12, 33])).toEqual({ finished: true, winners: [2] });
    expect(matchStanding([100, 99, 98, 97])).toEqual({ finished: true, winners: [3] });
  });

  it('empate no menor total não encerra a partida', () => {
    expect(matchStanding([120, 30, 30, 90])).toEqual({ finished: false, winners: [] });
  });

  it('exige os totais dos 4 assentos', () => {
    expect(() => matchStanding([1, 2, 3])).toThrow(RangeError);
  });
});
