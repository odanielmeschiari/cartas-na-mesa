import type { SeatIndex } from './game-definition';
import { createDeck, PATIENCE_VALUES, type PatienceCard } from './patience';
import { shuffle, type Rng } from './rng';

// Copas (Hearts) tradicional, 4 jogadores. Regras em docs/rules/copas.md.
// Módulo de regras puras: sem estado de partida, sem UI, sem rede. O motor (GameDefinition)
// entra em um passo posterior e consome estas funções.

/** Reuso deliberado do baralho de 52 cartas existente; Copas apenas muda o valor do Ás. */
export type HeartsCard = PatienceCard;

export const HEARTS_PLAYER_COUNT = 4;
export const HEARTS_HAND_SIZE = 13;
export const HEARTS_PASS_COUNT = 3;
export const HEARTS_TARGET_SCORE = 100;
/** 13 copas de 1 ponto + dama de espadas (13 pontos). */
export const HEARTS_POINTS_PER_HAND = 26;

/** Truque jogado em ordem: a primeira jogada é a abertura (define o naipe da vez). */
export type TrickPlay = { readonly seat: SeatIndex; readonly card: HeartsCard };

export type PassDirection = 'left' | 'right' | 'across' | 'none';

const PASS_CYCLE: readonly PassDirection[] = ['left', 'right', 'across', 'none'];

// ---------------------------------------------------------------------------
// Cartas
// ---------------------------------------------------------------------------

/** 2 a 14: no Copas o Ás é a carta mais alta. */
export function heartsRank(card: HeartsCard): number {
  const index = PATIENCE_VALUES.indexOf(card.value);
  return index === 0 ? 14 : index + 1;
}

export function isHeart(card: HeartsCard): boolean {
  return card.suit === 'copa';
}

export function isQueenOfSpades(card: HeartsCard): boolean {
  return card.suit === 'espada' && card.value === 'Q';
}

export function isTwoOfClubs(card: HeartsCard): boolean {
  return card.suit === 'paus' && card.value === '2';
}

/** Carta que vale ponto: qualquer copa ou a dama de espadas. */
export function isPointCard(card: HeartsCard): boolean {
  return isHeart(card) || isQueenOfSpades(card);
}

export function cardPoints(card: HeartsCard): number {
  if (isQueenOfSpades(card)) return 13;
  return isHeart(card) ? 1 : 0;
}

/** Só uma copa jogada quebra as copas; a dama de espadas não quebra. */
export function breaksHearts(card: HeartsCard): boolean {
  return isHeart(card);
}

// ---------------------------------------------------------------------------
// Distribuição e passe de cartas
// ---------------------------------------------------------------------------

/** Distribui 13 cartas por assento, uma a uma no sentido horário (assento 0, 1, 2, 3, 0...). */
export function dealHands(rng: Rng): HeartsCard[][] {
  const deck = shuffle(createDeck(), rng);
  return Array.from({ length: HEARTS_PLAYER_COUNT }, (_, seat) =>
    deck.filter((_card, index) => index % HEARTS_PLAYER_COUNT === seat),
  );
}

/** Assento que abre a mão: quem tem o 2 de paus. */
export function findOpeningSeat(hands: readonly (readonly HeartsCard[])[]): SeatIndex {
  const seat = hands.findIndex((hand) => hand.some(isTwoOfClubs));
  if (seat === -1) {
    throw new RangeError('Nenhuma mão contém o 2 de paus.');
  }
  return seat;
}

/** Ciclo de passe por mão (índice a partir de 0): esquerda, direita, frente, sem passe. */
export function passDirectionFor(handIndex: number): PassDirection {
  if (!Number.isInteger(handIndex) || handIndex < 0) {
    throw new RangeError('handIndex deve ser um inteiro não negativo.');
  }
  return PASS_CYCLE[handIndex % PASS_CYCLE.length] ?? 'none';
}

/** Assentos são numerados no sentido horário; "esquerda" é o próximo a jogar. */
export function passTargetSeat(fromSeat: SeatIndex, direction: PassDirection): SeatIndex {
  if (!Number.isInteger(fromSeat) || fromSeat < 0 || fromSeat >= HEARTS_PLAYER_COUNT) {
    throw new RangeError('Assento inválido.');
  }
  const offsets: Record<PassDirection, number> = { left: 1, right: 3, across: 2, none: 0 };
  return (fromSeat + offsets[direction]) % HEARTS_PLAYER_COUNT;
}

// ---------------------------------------------------------------------------
// Jogadas legais e truques
// ---------------------------------------------------------------------------

export type PlayContext = {
  /** Jogadas já feitas no truque atual, em ordem; vazio significa que quem joga abre o truque. */
  readonly trick: readonly TrickPlay[];
  readonly isFirstTrick: boolean;
  readonly heartsBroken: boolean;
};

export function legalPlays(hand: readonly HeartsCard[], context: PlayContext): HeartsCard[] {
  const lead = context.trick[0];

  if (lead === undefined) {
    if (context.isFirstTrick) {
      return hand.filter(isTwoOfClubs);
    }
    const nonHearts = hand.filter((card) => !isHeart(card));
    return context.heartsBroken || nonHearts.length === 0 ? [...hand] : nonHearts;
  }

  const followSuit = hand.filter((card) => card.suit === lead.card.suit);
  if (followSuit.length > 0) {
    return followSuit;
  }
  if (context.isFirstTrick) {
    const safe = hand.filter((card) => !isPointCard(card));
    return safe.length > 0 ? safe : [...hand];
  }
  return [...hand];
}

/** Vence a maior carta do naipe da abertura. Exige o truque completo (4 jogadas). */
export function trickWinner(trick: readonly TrickPlay[]): SeatIndex {
  const lead = trick[0];
  if (trick.length !== HEARTS_PLAYER_COUNT || lead === undefined) {
    throw new RangeError('trickWinner exige um truque completo com 4 jogadas.');
  }
  let winner = lead;
  for (const play of trick) {
    if (play.card.suit === lead.card.suit && heartsRank(play.card) > heartsRank(winner.card)) {
      winner = play;
    }
  }
  return winner.seat;
}

export function trickPoints(trick: readonly TrickPlay[]): number {
  return trick.reduce((sum, play) => sum + cardPoints(play.card), 0);
}

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------

export type HandScore = {
  /** Pontos que cada assento soma ao total da partida nesta mão. */
  readonly points: readonly number[];
  /** Assento que levou as 26 pontos (virou a lua), se houve. */
  readonly moonShooter: SeatIndex | null;
};

/** Pontua a mão pelas capturas de cada assento; quem leva as 26 pontos faz 0 e os outros, 26. */
export function scoreHand(captured: readonly (readonly HeartsCard[])[]): HandScore {
  if (captured.length !== HEARTS_PLAYER_COUNT) {
    throw new RangeError('scoreHand exige as cartas capturadas dos 4 assentos.');
  }
  const raw = captured.map((cards) => cards.reduce((sum, card) => sum + cardPoints(card), 0));
  if (raw.reduce((sum, value) => sum + value, 0) !== HEARTS_POINTS_PER_HAND) {
    throw new RangeError('As cartas capturadas devem somar 26 pontos.');
  }
  const shooter = raw.indexOf(HEARTS_POINTS_PER_HAND);
  if (shooter === -1) {
    return { points: raw, moonShooter: null };
  }
  return {
    points: raw.map((_value, seat) => (seat === shooter ? 0 : HEARTS_POINTS_PER_HAND)),
    moonShooter: shooter,
  };
}

export type MatchStanding =
  { finished: false; winners: readonly [] } | { finished: true; winners: readonly SeatIndex[] };

/**
 * A partida acaba ao fim da mão em que alguém chega a 100 ou mais; vence o menor total.
 * Empate no menor total: joga-se mais uma mão (a partida não termina).
 */
export function matchStanding(totals: readonly number[]): MatchStanding {
  if (totals.length !== HEARTS_PLAYER_COUNT) {
    throw new RangeError('matchStanding exige os totais dos 4 assentos.');
  }
  if (!totals.some((total) => total >= HEARTS_TARGET_SCORE)) {
    return { finished: false, winners: [] };
  }
  const lowest = Math.min(...totals);
  const winners = totals.flatMap((total, seat) => (total === lowest ? [seat] : []));
  return winners.length === 1 ? { finished: true, winners } : { finished: false, winners: [] };
}
