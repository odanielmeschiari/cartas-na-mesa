import {
  InvalidSetupError,
  type ApplyResult,
  type EngineAction,
  type GameDefinition,
  type PlayerSeed,
} from './game-definition';
import { shuffle, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Cartas
// ---------------------------------------------------------------------------

export type PatienceSuit = 'ouro' | 'copa' | 'espada' | 'paus';
export type PatienceValue =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface PatienceCard {
  suit: PatienceSuit;
  value: PatienceValue;
  id: string;
}

export const PATIENCE_SUITS: readonly PatienceSuit[] = ['ouro', 'copa', 'espada', 'paus'];
export const PATIENCE_VALUES: readonly PatienceValue[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

/** Ouros (♦) e copas (♥) são vermelhos; espadas (♠) e paus (♣) são pretos. */
export function cardColor(card: PatienceCard): 'vermelho' | 'preto' {
  return card.suit === 'ouro' || card.suit === 'copa' ? 'vermelho' : 'preto';
}

/** 1 (Ás) a 13 (Rei). */
export function cardRank(card: PatienceCard): number {
  return PATIENCE_VALUES.indexOf(card.value) + 1;
}

export function createDeck(): readonly PatienceCard[] {
  const chars: Record<PatienceSuit, string> = { ouro: 'o', copa: 'c', espada: 'e', paus: 'p' };
  const cards: PatienceCard[] = [];
  for (const suit of PATIENCE_SUITS) {
    for (const value of PATIENCE_VALUES) {
      cards.push({ suit, value, id: `${chars[suit]}-${value}` });
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Estado: Paciência Klondike, compra de 1 carta
// ---------------------------------------------------------------------------

export type PatienceState = {
  status: 'playing' | 'finished';
  currentTurnPlayerId: string;
  /** Monte: a próxima carta a virar é a ÚLTIMA do array. */
  stock: PatienceCard[];
  /** Descarte: a carta do topo é a ÚLTIMA do array. */
  waste: PatienceCard[];
  /** Colunas: do fundo (índice 0) ao topo. As `faceDown[col]` primeiras estão viradas para baixo. */
  tableau: PatienceCard[][];
  faceDown: number[];
  /** Uma pilha por naipe, na ordem de PATIENCE_SUITS. */
  foundations: PatienceCard[][];
  moves: number;
};

export type PatienceActionPayload =
  | { type: 'flip_stock' }
  | { type: 'waste_to_foundation' }
  | { type: 'waste_to_tableau'; toColumn: number }
  | { type: 'tableau_to_foundation'; fromColumn: number }
  | { type: 'tableau_to_tableau'; fromColumn: number; toColumn: number; cardId: string }
  | { type: 'foundation_to_tableau'; suit: PatienceSuit; toColumn: number };

export type PatienceEvent =
  | { type: 'card_moved'; cardId: string; from: string; to: string }
  | { type: 'stock_recycled' }
  | { type: 'game_finished'; outcome: 'win' };

export type PatiencePublicView = {
  gameId: string;
  status: PatienceState['status'];
  stockCount: number;
  wasteTop: PatienceCard | null;
  tableauHeights: readonly number[];
  foundationHeights: readonly number[];
};

// ---------------------------------------------------------------------------
// Regras (puras)
// ---------------------------------------------------------------------------

export function canPlaceOnFoundation(card: PatienceCard, pile: readonly PatienceCard[]): boolean {
  const top = pile[pile.length - 1];
  if (top === undefined) return card.value === 'A';
  return top.suit === card.suit && cardRank(card) === cardRank(top) + 1;
}

export function canPlaceOnTableau(card: PatienceCard, column: readonly PatienceCard[]): boolean {
  const top = column[column.length - 1];
  if (top === undefined) return card.value === 'K';
  return cardRank(card) === cardRank(top) - 1 && cardColor(card) !== cardColor(top);
}

function suitIndex(suit: PatienceSuit): number {
  return PATIENCE_SUITS.indexOf(suit);
}

function fail(code: 'invalid_setup' | 'card_not_in_hand', message: string) {
  return { ok: false as const, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Estado inicial
// ---------------------------------------------------------------------------

export function createInitialState(players: readonly PlayerSeed[], rng: Rng): PatienceState {
  const first = players[0];
  if (first === undefined) {
    throw new InvalidSetupError('Paciência requer pelo menos 1 jogador.');
  }
  const deck = shuffle(createDeck(), rng);
  const tableau: PatienceCard[][] = [];
  let next = 0;
  for (let col = 0; col < 7; col += 1) {
    tableau.push(deck.slice(next, next + col + 1));
    next += col + 1;
  }
  return {
    status: 'playing',
    currentTurnPlayerId: first.playerId,
    stock: deck.slice(next),
    waste: [],
    tableau,
    faceDown: tableau.map((column) => column.length - 1),
    foundations: [[], [], [], []],
    moves: 0,
  };
}

// ---------------------------------------------------------------------------
// Ações legais
// ---------------------------------------------------------------------------

function legalActions(state: PatienceState, playerId: string): readonly PatienceActionPayload[] {
  if (state.status === 'finished' || state.currentTurnPlayerId !== playerId) return [];
  const actions: PatienceActionPayload[] = [];

  if (state.stock.length > 0 || state.waste.length > 0) actions.push({ type: 'flip_stock' });

  const wasteTop = state.waste[state.waste.length - 1];
  if (wasteTop !== undefined) {
    if (canPlaceOnFoundation(wasteTop, state.foundations[suitIndex(wasteTop.suit)] ?? [])) {
      actions.push({ type: 'waste_to_foundation' });
    }
    state.tableau.forEach((column, toColumn) => {
      if (canPlaceOnTableau(wasteTop, column)) actions.push({ type: 'waste_to_tableau', toColumn });
    });
  }

  state.tableau.forEach((column, fromColumn) => {
    const top = column[column.length - 1];
    if (top !== undefined && canPlaceOnFoundation(top, state.foundations[suitIndex(top.suit)] ?? [])) {
      actions.push({ type: 'tableau_to_foundation', fromColumn });
    }
    for (let i = state.faceDown[fromColumn] ?? 0; i < column.length; i += 1) {
      const card = column[i];
      if (card === undefined) continue;
      state.tableau.forEach((target, toColumn) => {
        // Rei sozinho numa coluna vazia não é um movimento útil.
        if (toColumn === fromColumn || (card.value === 'K' && i === 0 && target.length === 0)) return;
        if (canPlaceOnTableau(card, target)) {
          actions.push({ type: 'tableau_to_tableau', fromColumn, toColumn, cardId: card.id });
        }
      });
    }
  });

  PATIENCE_SUITS.forEach((suit, s) => {
    const top = state.foundations[s]?.[(state.foundations[s]?.length ?? 0) - 1];
    if (top === undefined) return;
    state.tableau.forEach((column, toColumn) => {
      if (canPlaceOnTableau(top, column)) actions.push({ type: 'foundation_to_tableau', suit, toColumn });
    });
  });

  return actions;
}

// ---------------------------------------------------------------------------
// Aplicar ação
// ---------------------------------------------------------------------------

/** Vira a carta do topo de uma coluna se todas as cartas dela estiverem viradas para baixo. */
function revealTop(faceDown: readonly number[], column: number, remaining: number): number[] {
  return faceDown.map((n, i) => (i === column ? Math.min(n, Math.max(remaining - 1, 0)) : n));
}

function finish(state: PatienceState, events: PatienceEvent[]): ApplyResult<PatienceState, PatienceEvent> {
  const moved = { ...state, moves: state.moves + 1 };
  if (moved.foundations.reduce((sum, pile) => sum + pile.length, 0) === 52) {
    return {
      ok: true,
      state: { ...moved, status: 'finished' },
      events: [...events, { type: 'game_finished', outcome: 'win' }],
    };
  }
  return { ok: true, state: moved, events };
}

function applyAction(
  state: PatienceState,
  action: EngineAction<PatienceActionPayload>,
): ApplyResult<PatienceState, PatienceEvent> {
  if (state.status === 'finished') {
    return { ok: false, error: { code: 'game_finished', message: 'A partida já terminou.' } };
  }
  if (state.currentTurnPlayerId !== action.playerId) {
    return { ok: false, error: { code: 'not_your_turn', message: 'Não é o seu turno.' } };
  }

  const p = action.payload;
  switch (p.type) {
    case 'flip_stock': {
      if (state.stock.length === 0) {
        if (state.waste.length === 0) return fail('invalid_setup', 'Monte e descarte vazios.');
        return finish(
          { ...state, stock: [...state.waste].reverse(), waste: [] },
          [{ type: 'stock_recycled' }],
        );
      }
      const card = state.stock[state.stock.length - 1] as PatienceCard;
      return finish(
        { ...state, stock: state.stock.slice(0, -1), waste: [...state.waste, card] },
        [{ type: 'card_moved', cardId: card.id, from: 'stock', to: 'waste' }],
      );
    }

    case 'waste_to_foundation': {
      const card = state.waste[state.waste.length - 1];
      if (card === undefined) return fail('card_not_in_hand', 'O descarte está vazio.');
      const s = suitIndex(card.suit);
      if (!canPlaceOnFoundation(card, state.foundations[s] ?? [])) {
        return fail('invalid_setup', 'Essa carta não cabe na fundação.');
      }
      return finish(
        {
          ...state,
          waste: state.waste.slice(0, -1),
          foundations: state.foundations.map((pile, i) => (i === s ? [...pile, card] : pile)),
        },
        [{ type: 'card_moved', cardId: card.id, from: 'waste', to: 'foundation' }],
      );
    }

    case 'waste_to_tableau': {
      const card = state.waste[state.waste.length - 1];
      const target = state.tableau[p.toColumn];
      if (card === undefined) return fail('card_not_in_hand', 'O descarte está vazio.');
      if (target === undefined) return fail('invalid_setup', 'Coluna inválida.');
      if (!canPlaceOnTableau(card, target)) return fail('invalid_setup', 'Essa carta não cabe na coluna.');
      return finish(
        {
          ...state,
          waste: state.waste.slice(0, -1),
          tableau: state.tableau.map((col, i) => (i === p.toColumn ? [...col, card] : col)),
        },
        [{ type: 'card_moved', cardId: card.id, from: 'waste', to: 'tableau' }],
      );
    }

    case 'tableau_to_foundation': {
      const column = state.tableau[p.fromColumn];
      const card = column?.[column.length - 1];
      if (column === undefined || card === undefined) return fail('card_not_in_hand', 'Coluna vazia.');
      const s = suitIndex(card.suit);
      if (!canPlaceOnFoundation(card, state.foundations[s] ?? [])) {
        return fail('invalid_setup', 'Essa carta não cabe na fundação.');
      }
      return finish(
        {
          ...state,
          tableau: state.tableau.map((col, i) => (i === p.fromColumn ? col.slice(0, -1) : col)),
          faceDown: revealTop(state.faceDown, p.fromColumn, column.length - 1),
          foundations: state.foundations.map((pile, i) => (i === s ? [...pile, card] : pile)),
        },
        [{ type: 'card_moved', cardId: card.id, from: 'tableau', to: 'foundation' }],
      );
    }

    case 'tableau_to_tableau': {
      const from = state.tableau[p.fromColumn];
      const to = state.tableau[p.toColumn];
      if (from === undefined || to === undefined || p.fromColumn === p.toColumn) {
        return fail('invalid_setup', 'Coluna inválida.');
      }
      const start = from.findIndex((c) => c.id === p.cardId);
      if (start === -1 || start < (state.faceDown[p.fromColumn] ?? 0)) {
        return fail('card_not_in_hand', 'Carta indisponível na coluna de origem.');
      }
      const run = from.slice(start);
      if (!canPlaceOnTableau(run[0] as PatienceCard, to)) {
        return fail('invalid_setup', 'Essa carta não cabe na coluna de destino.');
      }
      return finish(
        {
          ...state,
          tableau: state.tableau.map((col, i) =>
            i === p.fromColumn ? from.slice(0, start) : i === p.toColumn ? [...to, ...run] : col,
          ),
          faceDown: revealTop(state.faceDown, p.fromColumn, start),
        },
        [{ type: 'card_moved', cardId: p.cardId, from: 'tableau', to: 'tableau' }],
      );
    }

    case 'foundation_to_tableau': {
      const s = suitIndex(p.suit);
      const pile = state.foundations[s];
      const card = pile?.[pile.length - 1];
      const target = state.tableau[p.toColumn];
      if (card === undefined) return fail('card_not_in_hand', 'Fundação vazia.');
      if (target === undefined || !canPlaceOnTableau(card, target)) {
        return fail('invalid_setup', 'Essa carta não cabe na coluna.');
      }
      return finish(
        {
          ...state,
          foundations: state.foundations.map((f, i) => (i === s ? f.slice(0, -1) : f)),
          tableau: state.tableau.map((col, i) => (i === p.toColumn ? [...col, card] : col)),
        },
        [{ type: 'card_moved', cardId: card.id, from: 'foundation', to: 'tableau' }],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Visões e resultado
// ---------------------------------------------------------------------------

function publicView(state: PatienceState): PatiencePublicView {
  return {
    gameId: 'patience',
    status: state.status,
    stockCount: state.stock.length,
    wasteTop: state.waste[state.waste.length - 1] ?? null,
    tableauHeights: state.tableau.map((col) => col.length),
    foundationHeights: state.foundations.map((pile) => pile.length),
  };
}

function viewFor(state: PatienceState, playerId: string) {
  return { playerId, legalActions: legalActions(state, playerId) };
}

function resultOf(state: PatienceState): { outcome: 'win' } | null {
  return state.status === 'finished' ? { outcome: 'win' } : null;
}

export const patienceGame: GameDefinition<
  PatienceState,
  PatienceActionPayload,
  PatiencePublicView,
  { playerId: string; legalActions: readonly PatienceActionPayload[] },
  { outcome: 'win' },
  PatienceEvent
> = {
  id: 'patience',
  playerCount: { min: 1, max: 1 },
  createInitialState,
  legalActions,
  applyAction,
  publicView,
  viewFor,
  resultOf,
};
