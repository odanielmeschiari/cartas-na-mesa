import {
  InvalidSetupError,
  UnknownPlayerError,
  type ApplyResult,
  type CardId,
  type EngineAction,
  type EngineError,
  type GameDefinition,
  type PlayerId,
  type PlayerSeed,
} from './game-definition';
import { shuffle, type Rng } from './rng';

export type FixtureActionPayload = { type: 'play_card'; cardId: CardId };

export type MatchResult = { outcome: 'draw' };

export type FixtureEvent =
  | { type: 'card_played'; playerId: PlayerId; cardId: CardId }
  | { type: 'turn_changed'; playerId: PlayerId }
  | { type: 'match_finished'; result: MatchResult };

export type FixturePublicView = {
  gameId: 'fixture';
  status: 'playing' | 'finished';
  currentTurnPlayerId: PlayerId | null;
  handSizes: readonly { playerId: PlayerId; count: number }[];
  table: readonly { playerId: PlayerId; cardId: CardId }[];
  result: MatchResult | null;
};

export type FixturePrivateView = {
  playerId: PlayerId;
  hand: readonly CardId[];
  legalActions: readonly FixtureActionPayload[];
};

// Estado interno deliberadamente não exportado: o servidor só enxerga as projeções.
type PlayerHands = readonly [readonly CardId[], readonly CardId[]];

type FixtureState = {
  readonly status: 'playing' | 'finished';
  readonly playerIds: readonly [PlayerId, PlayerId];
  readonly hands: PlayerHands;
  readonly table: readonly { readonly playerId: PlayerId; readonly cardId: CardId }[];
  readonly currentTurnPlayerId: PlayerId | null;
  readonly result: MatchResult | null;
};

const CARD_IDS: readonly CardId[] = ['c1', 'c2', 'c3', 'c4'];
const PLAYER_COUNT = { min: 2, max: 2 } as const;

function orderedSeats(players: readonly PlayerSeed[]): readonly [PlayerSeed, PlayerSeed] {
  if (players.length !== 2) {
    throw new InvalidSetupError('A partida exige exatamente 2 jogadores.');
  }
  const seats = new Set(players.map((player) => player.seatIndex));
  const ids = new Set(players.map((player) => player.playerId));
  if (seats.size !== 2 || !seats.has(0) || !seats.has(1) || ids.size !== 2) {
    throw new InvalidSetupError('Os assentos devem ser 0 e 1, com jogadores distintos.');
  }
  const bySeat = new Map(players.map((player) => [player.seatIndex, player]));
  const seat0 = bySeat.get(0);
  const seat1 = bySeat.get(1);
  if (seat0 === undefined || seat1 === undefined) {
    throw new InvalidSetupError('Os assentos devem ser 0 e 1.');
  }
  return [seat0, seat1];
}

function createInitialState(players: readonly PlayerSeed[], rng: Rng): FixtureState {
  const [seat0, seat1] = orderedSeats(players);
  const deck = shuffle(CARD_IDS, rng);
  const hand0 = deck.filter((_, index) => index % 2 === 0);
  const hand1 = deck.filter((_, index) => index % 2 === 1);
  return {
    status: 'playing',
    playerIds: [seat0.playerId, seat1.playerId],
    hands: [hand0, hand1],
    table: [],
    currentTurnPlayerId: seat0.playerId,
    result: null,
  };
}

function seatOf(state: FixtureState, playerId: PlayerId): 0 | 1 | null {
  if (state.playerIds[0] === playerId) {
    return 0;
  }
  if (state.playerIds[1] === playerId) {
    return 1;
  }
  return null;
}

function handFor(state: FixtureState, playerId: PlayerId): readonly CardId[] | null {
  const seat = seatOf(state, playerId);
  if (seat === null) {
    return null;
  }
  return seat === 0 ? state.hands[0] : state.hands[1];
}

function legalActions(state: FixtureState, playerId: PlayerId): readonly FixtureActionPayload[] {
  if (state.status !== 'playing' || state.currentTurnPlayerId !== playerId) {
    return [];
  }
  const hand = handFor(state, playerId);
  if (hand === null) {
    return [];
  }
  return hand.map((cardId) => ({ type: 'play_card', cardId }));
}

function failure(
  code: EngineError['code'],
  message: string,
): ApplyResult<FixtureState, FixtureEvent> {
  return { ok: false, error: { code, message } };
}

function nextSeatWithCards(hands: PlayerHands, from: 0 | 1): 0 | 1 {
  const first: 0 | 1 = from === 0 ? 1 : 0;
  if (hands[first].length > 0) {
    return first;
  }
  const second: 0 | 1 = from === 0 ? 0 : 1;
  if (hands[second].length > 0) {
    return second;
  }
  throw new Error('nextSeatWithCards exige ao menos uma mão com cartas.');
}

function applyAction(
  state: FixtureState,
  action: EngineAction<FixtureActionPayload>,
): ApplyResult<FixtureState, FixtureEvent> {
  if (state.status === 'finished') {
    return failure('game_finished', 'A partida já terminou.');
  }
  const seat = seatOf(state, action.playerId);
  if (seat === null || state.currentTurnPlayerId !== action.playerId) {
    return failure('not_your_turn', 'Não é o turno deste jogador.');
  }
  const hand = seat === 0 ? state.hands[0] : state.hands[1];
  const cardIndex = hand.indexOf(action.payload.cardId);
  if (cardIndex === -1) {
    return failure('card_not_in_hand', 'A carta não está na mão deste jogador.');
  }

  const nextHand = hand.filter((_, index) => index !== cardIndex);
  const hands: PlayerHands = seat === 0 ? [nextHand, state.hands[1]] : [state.hands[0], nextHand];
  const table = [...state.table, { playerId: action.playerId, cardId: action.payload.cardId }];
  const events: FixtureEvent[] = [
    { type: 'card_played', playerId: action.playerId, cardId: action.payload.cardId },
  ];

  if (hands[0].length === 0 && hands[1].length === 0) {
    const result: MatchResult = { outcome: 'draw' };
    events.push({ type: 'match_finished', result });
    return {
      ok: true,
      state: { ...state, status: 'finished', hands, table, currentTurnPlayerId: null, result },
      events,
    };
  }

  const nextSeat = nextSeatWithCards(hands, seat);
  const nextPlayerId = state.playerIds[nextSeat];
  events.push({ type: 'turn_changed', playerId: nextPlayerId });
  return {
    ok: true,
    state: { ...state, hands, table, currentTurnPlayerId: nextPlayerId },
    events,
  };
}

function publicView(state: FixtureState): FixturePublicView {
  return {
    gameId: 'fixture',
    status: state.status,
    currentTurnPlayerId: state.currentTurnPlayerId,
    handSizes: [
      { playerId: state.playerIds[0], count: state.hands[0].length },
      { playerId: state.playerIds[1], count: state.hands[1].length },
    ],
    table: state.table.map((entry) => ({ ...entry })),
    result: state.result === null ? null : { ...state.result },
  };
}

function viewFor(state: FixtureState, playerId: PlayerId): FixturePrivateView {
  const hand = handFor(state, playerId);
  if (hand === null) {
    throw new UnknownPlayerError(playerId);
  }
  return {
    playerId,
    hand: [...hand],
    legalActions: legalActions(state, playerId),
  };
}

function resultOf(state: FixtureState): MatchResult | null {
  return state.result;
}

export const fixtureGame: GameDefinition<
  FixtureState,
  FixtureActionPayload,
  FixturePublicView,
  FixturePrivateView,
  MatchResult,
  FixtureEvent
> = {
  id: 'fixture',
  playerCount: PLAYER_COUNT,
  createInitialState,
  legalActions,
  applyAction,
  publicView,
  viewFor,
  resultOf,
};
