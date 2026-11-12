import {
  InvalidSetupError,
  UnknownPlayerError,
  type ApplyResult,
  type GameDefinition,
  type EngineAction,
  type EngineError,
  type PlayerSeed,
} from './game-definition';

import { createSeededRng, shuffle, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Card types
// ---------------------------------------------------------------------------

export type PatienceSuit = 'ouro' | 'copa' | 'espada' | 'paus';
export type PatienceValue =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K';

export interface PatienceCard {
  suit: PatienceSuit;
  value: PatienceValue;
  id: string;
}

// Derived: color for alternating moves in the tableau
export function cardColor(card: PatienceCard): 'vermelho' | 'preto' {
  return card.suit === 'ouro' || card.suit === 'paus' ? 'vermelho' : 'preto';
}

// Order of values for comparison
const VALUE_ORDER: readonly PatienceValue[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

function valueIndex(v: PatienceValue): number {
  const i = VALUE_ORDER.indexOf(v);
  if (i === -1) throw new Error(`Valor de carta inválido: ${v}`);
  return i;
}

// ---------------------------------------------------------------------------
// Deck construction
// ---------------------------------------------------------------------------

const SUIT_CHARS = { ouro: 'o', copa: 'c', espada: 'e', paus: 'p' };

function suitChar(suit: PatienceSuit): string {
  return SUIT_CHARS[suit];
}

// Creates a complete 52-card deck with unique string IDs
export function createDeck(): readonly PatienceCard[] {
  const suits: PatienceSuit[] = ['ouro', 'copa', 'espada', 'paus'];
  const cards: PatienceCard[] = [];
  let counter = 0;
  for (const suit of suits) {
    for (const value of VALUE_ORDER) {
      cards.push({
        suit,
        value,
        id: `${suitChar(suit)}-${value}-${counter++}`,
      });
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Game state - use plain arrays, readonly is a static contract
// ---------------------------------------------------------------------------

export type PatienceState = {
  status: 'playing' | 'finished';
  currentTurnPlayerId: string;
  stock: PatienceCard[];
  waste: PatienceCard[];
  tableau: PatienceCard[][];
  foundations: PatienceCard[][];
  freeCells: (PatienceCard | null)[];
};

// ---------------------------------------------------------------------------
// Action payload types
// ---------------------------------------------------------------------------

export type PatienceActionType =
  | 'flip_stock'
  | 'move_to_foundations'
  | 'move_to_free_cell'
  | 'move_from_free_cell_to_tableau'
  | 'move_from_free_cell_to_foundations'
  | 'move_from_tableau_to_free_cell'
  | 'move_from_tableau_to_foundations'
  | 'move_from_tableau_to_tableau';

export type PatienceActionPayload =
  | { type: 'flip_stock' }
  | { type: 'move_to_foundations'; cardId: string; suit: PatienceSuit }
  | { type: 'move_to_free_cell'; cardId: string }
  | {
      type: 'move_from_free_cell_to_tableau';
      cardId: string;
      targetColumn: number;
    }
  | {
      type: 'move_from_free_cell_to_foundations';
      cardId: string;
      suit: PatienceSuit;
    }
  | {
      type: 'move_from_tableau_to_free_cell';
      fromColumn: number;
      cardId: string;
    }
  | {
      type: 'move_from_tableau_to_foundations';
      fromColumn: number;
      suit: PatienceSuit;
    }
  | {
      type: 'move_from_tableau_to_tableau';
      fromColumn: number;
      toColumn: number;
      cardId: string;
    };

// ---------------------------------------------------------------------------
// Helper: find card in array by id
// ---------------------------------------------------------------------------

function findCardById<T extends { readonly id: string }>(
  array: readonly T[],
  id: string,
): T | undefined {
  for (const c of array) {
    if (c.id === id) return c;
  }
  return undefined;
}

// Helpers for foundation logic
function canMoveToFoundations(
  card: PatienceCard,
  foundationPile: readonly PatienceCard[],
  suit: PatienceSuit,
): boolean {
  if (foundationPile.length === 0) {
    return card.value === 'A' && card.suit === suit;
  }
  const top = foundationPile[foundationPile.length - 1];
  const nextIdx = valueIndex(top.value) + 1;
  return nextIdx === valueIndex(card.value) && card.suit === suit;
}

// Helpers for tableau logic
function willFitOnTableau(
  card: PatienceCard,
  targetColumn: readonly PatienceCard[],
): boolean {
  if (targetColumn.length === 0) {
    return card.value === 'K';
  }
  const top = targetColumn[targetColumn.length - 1];
  const topIdx = valueIndex(top.value);
  const cardIdx = valueIndex(card.value);
  if (cardIdx !== topIdx - 1) {
    return false;
  }
  return cardColor(card) !== cardColor(top);
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

function setupTableau(columns: number, deck: readonly PatienceCard[]): PatienceCard[][] {
  const result: PatienceCard[][] = [];
  let idx = 0;
  for (let col = 0; col < columns; col += 1) {
    const column: PatienceCard[] = [];
    for (let i = 0; i <= col; i += 1) {
      column.push(deck[idx++]);
    }
    result.push(column);
  }
  return result;
}

export function createInitialState(
  players: readonly PlayerSeed[],
  rng: Rng,
): PatienceState {
  if (players.length === 0) {
    throw new InvalidSetupError('Paciência requer pelo menos 1 jogador.');
  }

  const deck = shuffle(createDeck(), rng);
  const tableau = setupTableau(7, deck);

  // 28 cartas distribuídas no tableau (1+2+...+7); o resto vira stock
  const stock: PatienceCard[] = deck.slice(28);
  const waste: PatienceCard[] = [];

  const foundations: PatienceCard[][] = [[], [], [], []];
  const freeCells: (PatienceCard | null)[] = [null, null, null, null];

  const playerId = players[0].playerId;

  return {
    status: 'playing',
    currentTurnPlayerId: playerId,
    stock,
    waste,
    tableau,
    foundations,
    freeCells,
  };
}

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

function legalActions(
  state: PatienceState,
  playerId: string,
): readonly PatienceActionPayload[] {
  if (state.currentTurnPlayerId !== playerId) {
    return [];
  }

  const actions: PatienceActionPayload[] = [];

  // 1. Flip stock
  if (state.stock.length > 0) {
    actions.push({ type: 'flip_stock' });
  }

  // 2. Move from waste to foundations
  if (state.waste.length > 0) {
    const top = state.waste[state.waste.length - 1];
    for (let s = 0; s < 4; s += 1) {
      const suit: PatienceSuit = ['ouro', 'copa', 'espada', 'paus'][s];
      if (canMoveToFoundations(top as PatienceCard, state.foundations[s] as readonly PatienceCard[], suit)) {
        actions.push({ type: 'move_to_foundations', cardId: top.id, suit });
      }
    }
  }

  // 3. Move from waste to tableau columns
  if (state.waste.length > 0) {
    const top = state.waste[state.waste.length - 1];
    for (let col = 0; col < 7; col += 1) {
      if (willFitOnTableau(top as PatienceCard, state.tableau[col] as readonly PatienceCard[])) {
        actions.push({
          type: 'move_from_tableau_to_tableau',
          cardId: top.id,
          fromColumn: -1,
          toColumn: col,
        });
      }
    }
  }

  // 4. Move from tableau to foundations
  for (let col = 0; col < 7; col += 1) {
    const column = state.tableau[col] as readonly PatienceCard[];
    if (column.length === 0) continue;
    const top = column[column.length - 1];
    for (let s = 0; s < 4; s += 1) {
      const suit: PatienceSuit = ['ouro', 'copa', 'espada', 'paus'][s];
      if (canMoveToFoundations(top as PatienceCard, state.foundations[s] as readonly PatienceCard[], suit)) {
        actions.push({
          type: 'move_from_tableau_to_foundations',
          fromColumn: col,
          suit,
          cardId: top.id,
        });
      }
    }
  }

  // 5. Move from tableau to free cells
  for (let col = 0; col < 7; col += 1) {
    const column = state.tableau[col] as readonly PatienceCard[];
    if (column.length === 0) continue;
    const top = column[column.length - 1];
    for (let slot = 0; slot < 4; slot += 1) {
      if (state.freeCells[slot] === null) {
        actions.push({
          type: 'move_from_tableau_to_free_cell',
          fromColumn: col,
          cardId: top.id,
        });
      }
    }
  }

  // 6. Move from free cells to foundations
  for (let slot = 0; slot < 4; slot += 1) {
    const card = state.freeCells[slot];
    if (card === null) continue;
    for (let s = 0; s < 4; s += 1) {
      const suit: PatienceSuit = ['ouro', 'copa', 'espada', 'paus'][s];
      if (canMoveToFoundations(card as PatienceCard, state.foundations[s] as readonly PatienceCard[], suit)) {
        actions.push({
          type: 'move_from_free_cell_to_foundations',
          cardId: card.id,
          suit,
        });
      }
    }
  }

  // 7. Move from free cells to tableau
  for (let slot = 0; slot < 4; slot += 1) {
    const card = state.freeCells[slot];
    if (card === null) continue;
    for (let col = 0; col < 7; col += 1) {
      if (willFitOnTableau(card as PatienceCard, state.tableau[col] as readonly PatienceCard[])) {
        actions.push({
          type: 'move_from_free_cell_to_tableau',
          cardId: card.id,
          targetColumn: col,
        });
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

function applyAction(
  state: PatienceState,
  action: EngineAction<PatienceActionPayload>,
): ApplyResult<PatienceState, PatienceEvent> {
  if (state.status === 'finished') {
    return {
      ok: false,
      error: { code: 'game_finished', message: 'A partida já terminou.' },
    };
  }
  if (state.currentTurnPlayerId !== action.playerId) {
    return {
      ok: false,
      error: { code: 'not_your_turn', message: 'Não é o seu turno.' },
    };
  }

  // Helper to get suit index
  const suitIdx = (s: string): number => ['ouro', 'copa', 'espada', 'paus'].indexOf(s);

  switch (action.payload.type) {
    case 'flip_stock': {
      if (state.stock.length === 0) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'Stock vazio.' },
        };
      }
      const newWaste = [state.stock[0], ...state.waste];
      const newStock = state.stock.slice(1);
      return {
        ok: true,
        state: {
          ...state,
          waste: newWaste,
          stock: newStock,
        },
        events: [
          { type: 'card_moved', cardId: newWaste[0]!.id, from: 'stock', to: 'waste' },
        ],
      };
    }

    case 'move_to_foundations': {
      const { cardId, suit } = action.payload;
      const suitNumber = suitIdx(suit);
      if (suitNumber === -1) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'Naipe inválido.' },
        };
      }
      const topWasteCard = state.waste[state.waste.length - 1] as PatienceCard;
      if (topWasteCard.id !== cardId) {
        return {
          ok: false,
          error: { code: 'card_not_in_hand', message: 'Carta não está no waste.' },
        };
      }
      const newWaste = state.waste.slice(0, -1);

      const newFoundations = state.foundations.map((pile, i) => {
        if (i === suitNumber) {
          return [...pile, topWasteCard];
        }
        return pile;
      });

      return {
        ok: true,
        state: {
          ...state,
          waste: newWaste,
          foundations: newFoundations,
        },
        events: [
          { type: 'card_moved', cardId: topWasteCard.id, from: 'waste', to: 'foundations' },
        ],
      };
    }

    case 'move_from_tableau_to_foundations': {
      const { fromColumn, suit } = action.payload;
      const suitNumber = suitIdx(suit);
      if (suitNumber === -1) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'Naipe inválido.' },
        };
      }
      const column = state.tableau[fromColumn] as readonly PatienceCard[];
      if (column.length === 0) {
        return { ok: false, error: { code: 'card_not_in_hand', message: 'Nenhuma carta na coluna.' } };
      }
      const topCard = column[column.length - 1] as PatienceCard;
// Card identified as the top of the tableau column; no payload.cardId needed
      const newTableau = state.tableau.map((c, i) =>
        i === fromColumn ? c.slice(0, -1) : c,
      );

      const newFoundations = state.foundations.map((pile, i) => {
        if (i === suitNumber) {
          return [...pile, topCard];
        }
        return pile;
      });

      return {
        ok: true,
        state: {
          ...state,
          tableau: newTableau,
          foundations: newFoundations,
        },
        events: [
          { type: 'card_moved', cardId: topCard.id, from: 'tableau', to: 'foundations' },
        ],
      };
    }

    case 'move_from_tableau_to_free_cell': {
      const { fromColumn, cardId } = action.payload;
      const column = state.tableau[fromColumn] as readonly PatienceCard[];
      if (column.length === 0) {
        return { ok: false, error: { code: 'card_not_in_hand', message: 'Nenhuma carta na coluna.' } };
      }
      const topCard = column[column.length - 1] as PatienceCard;
      if (topCard.id !== cardId) {
        return {
          ok: false,
          error: { code: 'card_not_in_hand', message: 'Carta não está na coluna.' },
        };
      }

      let emptySlot = -1;
      for (let s = 0; s < 4; s += 1) {
        if (state.freeCells[s] === null) {
          emptySlot = s;
          break;
        }
      }
      if (emptySlot === -1) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'Nenhuma célula livre disponível.' },
        };
      }

      const newFreeCells = [...state.freeCells];
      newFreeCells[emptySlot] = topCard;

      const newTableau = state.tableau.map((c, i) =>
        i === fromColumn ? c.slice(0, -1) : c,
      );

      return {
        ok: true,
        state: {
          ...state,
          tableau: newTableau,
          freeCells: newFreeCells,
        },
        events: [
          { type: 'card_moved', cardId: topCard.id, from: 'tableau', to: 'free_cell' },
        ],
      };
    }

    case 'move_from_free_cell_to_foundations': {
      const { cardId, suit } = action.payload;
      const card = state.freeCells.find((c) => c?.id === cardId);
      if (!card) {
        return { ok: false, error: { code: 'card_not_in_hand', message: 'Carta não está na célula livre.' } };
      }

      const suitNumber = suitIdx(suit);
      if (suitNumber === -1) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'Naipe inválido.' },
        };
      }

      const newFreeCells = state.freeCells.map((c) => (c?.id === cardId ? null : c));

      const newFoundations = state.foundations.map((pile, i) => {
        if (i === suitNumber) {
          return [...pile, card];
        }
        return pile;
      });

      return {
        ok: true,
        state: {
          ...state,
          freeCells: newFreeCells,
          foundations: newFoundations,
        },
        events: [
          { type: 'card_moved', cardId: card.id, from: 'free_cell', to: 'foundations' },
        ],
      };
    }

    case 'move_from_free_cell_to_tableau': {
      const { cardId, targetColumn } = action.payload;
      const card = state.freeCells.find((c) => c?.id === cardId);
      if (!card) {
        return { ok: false, error: { code: 'card_not_in_hand', message: 'Carta não está na célula livre.' } };
      }

      const target = state.tableau[targetColumn] as readonly PatienceCard[];
      if (!willFitOnTableau(card as PatienceCard, target)) {
        return {
          ok: false,
          error: { code: 'invalid_setup', message: 'A carta não cabe na coluna alvo.' },
        };
      }

      const newFreeCells = state.freeCells.map((c) => (c?.id === cardId ? null : c));

      const newTableau = state.tableau.map((col, i) =>
        i === targetColumn ? [...col, card] : col,
      );

      return {
        ok: true,
        state: {
          ...state,
          tableau: newTableau,
          freeCells: newFreeCells,
        },
        events: [
          { type: 'card_moved', cardId: card.id, from: 'free_cell', to: 'tableau' },
        ],
      };
    }

    case 'move_from_tableau_to_tableau': {
      const { fromColumn, toColumn, cardId } = action.payload;
      const fromColumnData = state.tableau[fromColumn] as readonly PatienceCard[];
      if (fromColumnData.length === 0) {
        return { ok: false, error: { code: 'card_not_in_hand', message: 'Nenhuma carta na coluna de origem.' } };
      }
      const topCard = fromColumnData[fromColumnData.length - 1] as PatienceCard;
      if (topCard.id !== cardId) {
        return {
          ok: false,
          error: { code: 'card_not_in_hand', message: 'Carta não está na coluna de origem.' },
        };
      }

      // Remover da coluna de origem
      const newFrom = fromColumnData.slice(0, -1);

      // Verificar se cabe na coluna de destino
      const toColumnData = state.tableau[toColumn] as readonly PatienceCard[];
      if (toColumnData.length === 0) {
        // Coluna vazia só aceita Rei
        if (topCard.value !== 'K') {
          return {
            ok: false,
            error: {
              code: 'invalid_setup',
              message: 'Apenas Reis podem ser colocados em colunas vazias.',
            },
          };
        }
      } else {
        const topOfTarget = toColumnData[toColumnData.length - 1] as PatienceCard;
        const topIdx = valueIndex(topOfTarget.value);
        const cardIdx = valueIndex(topCard.value);
        if (cardIdx !== topIdx - 1) {
          return {
            ok: false,
            error: { code: 'invalid_setup', message: 'Carta não segue a sequência da coluna destino.' },
          };
        }
        if (cardColor(topCard) === cardColor(topOfTarget)) {
          return {
            ok: false,
            error: { code: 'invalid_setup', message: 'As cartas devem ter cores alternadas.' },
          };
        }
      }

      const newTo = [...toColumnData, topCard];
      const newTableau = state.tableau.map((col, i) =>
        i === fromColumn ? newFrom : i === toColumn ? newTo : col,
      );

      return {
        ok: true,
        state: {
          ...state,
          tableau: newTableau,
        },
        events: [
          { type: 'card_moved', cardId: topCard.id, from: 'tableau', to: 'tableau' },
        ],
      };
    }

    default:
      return {
        ok: false,
        error: { code: 'invalid_setup', message: 'Ação não reconhecida.' },
      };
  }
}

// ---------------------------------------------------------------------------
// publicView
// ---------------------------------------------------------------------------

function publicView(state: PatienceState) {
  const wasteTop = state.waste[state.waste.length - 1] ?? null;
  const tableauHeights = state.tableau.map((col) => col.length);
  const foundationHeights = state.foundations.map((pile) => pile.length);
  const freeCellsCount = state.freeCells.filter((c) => c !== null).length;

  return {
    gameId: 'patience',
    status: state.status,
    currentTurnPlayerId: state.currentTurnPlayerId,
    stockCount: state.stock.length,
    wasteTop:
      wasteTop !== null
        ? { id: wasteTop.id, suit: wasteTop.suit, value: wasteTop.value }
        : null,
    tableauHeights,
    foundationHeights,
    freeCellsCount,
  };
}

// ---------------------------------------------------------------------------
// viewFor
// ---------------------------------------------------------------------------

function viewFor(state: PatienceState, playerId: string) {
  return {
    playerId,
    legalActions: legalActions(state, playerId),
  };
}

// ---------------------------------------------------------------------------
// resultOf
// ---------------------------------------------------------------------------

function resultOf(state: PatienceState) {
  const totalInFoundations = state.foundations.reduce(
    (sum, pile) => sum + pile.length,
    0,
  );
  if (totalInFoundations === 52) {
    return { outcome: 'win' as const };
  }
  // Draw condition: stock empty and no valid moves
  const hasValidMoves =
    state.stock.length > 0 ||
    legalActions(state, state.currentTurnPlayerId).length > 0;
  if (!hasValidMoves && state.stock.length === 0) {
    return { outcome: 'draw' as const };
  }
  return { outcome: 'continue' as const };
}

// ---------------------------------------------------------------------------
// PatienceEvent type
// ---------------------------------------------------------------------------

export type PatienceEvent =
  | { type: 'card_moved'; cardId: string; from: string; to: string }
  | { type: 'turn_changed'; playerId: string }
  | { type: 'game_finished'; outcome: 'win' | 'draw' | 'continue' };

// ---------------------------------------------------------------------------
// Game definition export
// ---------------------------------------------------------------------------

export const patienceGame: GameDefinition<PatienceState, PatienceActionPayload, {
  gameId: string;
  status: 'playing' | 'finished';
  currentTurnPlayerId: string;
  stockCount: number;
  wasteTop:
    | { readonly id: string; readonly suit: PatienceSuit; readonly value: PatienceValue }
    | null;
  tableauHeights: readonly number[];
  foundationHeights: readonly number[];
  freeCellsCount: number;
}, {
  playerId: string;
  legalActions: readonly PatienceActionPayload[];
}, { outcome: 'win' | 'draw' | 'continue' }, PatienceEvent> = {
  id: 'patience',
  playerCount: { min: 1, max: 1 },
  createInitialState,
  legalActions,
  applyAction,
  publicView,
  viewFor,
  resultOf,
};