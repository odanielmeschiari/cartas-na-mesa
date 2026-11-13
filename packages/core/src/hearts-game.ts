import {
  InvalidSetupError,
  UnknownPlayerError,
  type ApplyResult,
  type EngineAction,
  type EngineError,
  type GameDefinition,
  type PlayerId,
  type PlayerSeed,
  type SeatIndex,
} from './game-definition';
import {
  HEARTS_PASS_COUNT,
  HEARTS_PLAYER_COUNT,
  breaksHearts,
  dealHands,
  findOpeningSeat,
  legalPlays,
  matchStanding,
  passDirectionFor,
  passTargetSeat,
  scoreHand,
  trickPoints,
  trickWinner,
  type HandScore,
  type HeartsCard,
  type PassDirection,
  type TrickPlay,
} from './hearts';
import type { Rng } from './rng';

// Motor do Copas sobre as regras puras de ./hearts. docs/rules/copas.md define as regras.
// A mão seguinte precisa de Rng, que applyAction não recebe: ao fim de cada mão o estado fica
// em 'hand_over' e quem hospeda a partida chama startNextHand(state, rng).

export type HeartsPhase = 'passing' | 'playing' | 'hand_over' | 'finished';

export type HeartsActionPayload =
  { type: 'pass_cards'; cardIds: readonly string[] } | { type: 'play_card'; cardId: string };

export type HeartsEvent =
  | { type: 'pass_confirmed'; playerId: PlayerId }
  | { type: 'passing_completed' }
  | { type: 'card_played'; playerId: PlayerId; cardId: string }
  | { type: 'trick_won'; playerId: PlayerId; points: number }
  | { type: 'hand_finished'; points: readonly number[]; moonShooter: PlayerId | null }
  | { type: 'game_finished'; winners: readonly PlayerId[] };

export type HeartsResult = { winners: readonly PlayerId[]; totals: readonly number[] };

// Estado completo, inclusive mãos: o servidor só deve expor as projeções.
export type HeartsState = {
  readonly phase: HeartsPhase;
  /** Jogadores por assento. */
  readonly playerIds: readonly PlayerId[];
  readonly handIndex: number;
  readonly passDirection: PassDirection;
  readonly hands: readonly (readonly HeartsCard[])[];
  /** Cartas já escolhidas para o passe, por assento; null enquanto não confirmou. */
  readonly passSelections: readonly (readonly HeartsCard[] | null)[];
  readonly trick: readonly TrickPlay[];
  readonly tricksPlayed: number;
  readonly heartsBroken: boolean;
  readonly captured: readonly (readonly HeartsCard[])[];
  readonly currentTurnSeat: SeatIndex | null;
  readonly totals: readonly number[];
  readonly lastHandScore: HandScore | null;
  readonly winners: readonly SeatIndex[];
};

export type HeartsPublicView = {
  gameId: 'hearts';
  phase: HeartsPhase;
  handIndex: number;
  passDirection: PassDirection;
  currentTurnPlayerId: PlayerId | null;
  handSizes: readonly { playerId: PlayerId; count: number }[];
  passConfirmed: readonly { playerId: PlayerId; confirmed: boolean }[];
  trick: readonly { playerId: PlayerId; cardId: string }[];
  heartsBroken: boolean;
  totals: readonly { playerId: PlayerId; total: number }[];
  lastHandPoints: readonly number[] | null;
};

export type HeartsPrivateView = {
  playerId: PlayerId;
  hand: readonly HeartsCard[];
  /** O que este jogador já escolheu para passar; nunca vai para os outros. */
  passSelection: readonly string[] | null;
  legalActions: readonly HeartsActionPayload[];
};

const PLAYER_COUNT = { min: HEARTS_PLAYER_COUNT, max: HEARTS_PLAYER_COUNT } as const;
const TRICKS_PER_HAND = 13;

function failure(
  code: EngineError['code'],
  message: string,
): ApplyResult<HeartsState, HeartsEvent> {
  return { ok: false, error: { code, message } };
}

function nulls(): null[] {
  return Array.from({ length: HEARTS_PLAYER_COUNT }, () => null);
}

function empties(): HeartsCard[][] {
  return Array.from({ length: HEARTS_PLAYER_COUNT }, () => []);
}

// ---------------------------------------------------------------------------
// Início de mão
// ---------------------------------------------------------------------------

function enterPlaying(state: HeartsState): HeartsState {
  return {
    ...state,
    phase: 'playing',
    passSelections: nulls(),
    currentTurnSeat: findOpeningSeat(state.hands),
  };
}

function beginHand(
  playerIds: readonly PlayerId[],
  handIndex: number,
  totals: readonly number[],
  lastHandScore: HandScore | null,
  rng: Rng,
): HeartsState {
  const passDirection = passDirectionFor(handIndex);
  const state: HeartsState = {
    phase: 'passing',
    playerIds,
    handIndex,
    passDirection,
    hands: dealHands(rng),
    passSelections: nulls(),
    trick: [],
    tricksPlayed: 0,
    heartsBroken: false,
    captured: empties(),
    currentTurnSeat: null,
    totals,
    lastHandScore,
    winners: [],
  };
  return passDirection === 'none' ? enterPlaying(state) : state;
}

function createInitialState(players: readonly PlayerSeed[], rng: Rng): HeartsState {
  if (players.length !== HEARTS_PLAYER_COUNT) {
    throw new InvalidSetupError('Copas exige exatamente 4 jogadores.');
  }
  const bySeat = new Map(players.map((player) => [player.seatIndex, player.playerId]));
  const playerIds = Array.from({ length: HEARTS_PLAYER_COUNT }, (_, seat) => bySeat.get(seat));
  if (new Set(players.map((player) => player.playerId)).size !== HEARTS_PLAYER_COUNT) {
    throw new InvalidSetupError('Os jogadores devem ser distintos.');
  }
  if (playerIds.some((id) => id === undefined)) {
    throw new InvalidSetupError('Os assentos devem ser 0, 1, 2 e 3.');
  }
  return beginHand(
    playerIds.filter((id): id is PlayerId => id !== undefined),
    0,
    [0, 0, 0, 0],
    null,
    rng,
  );
}

/** Distribui a mão seguinte. Só vale em 'hand_over'; quem hospeda a partida fornece o Rng. */
export function startNextHand(state: HeartsState, rng: Rng): HeartsState {
  if (state.phase !== 'hand_over') {
    throw new InvalidSetupError('A próxima mão só começa depois do fim da mão atual.');
  }
  return beginHand(state.playerIds, state.handIndex + 1, state.totals, state.lastHandScore, rng);
}

// ---------------------------------------------------------------------------
// Ações legais
// ---------------------------------------------------------------------------

function seatOf(state: HeartsState, playerId: PlayerId): SeatIndex | null {
  const seat = state.playerIds.indexOf(playerId);
  return seat === -1 ? null : seat;
}

function combinations(cards: readonly HeartsCard[], size: number): HeartsCard[][] {
  if (size === 0) return [[]];
  return cards.flatMap((card, index) =>
    combinations(cards.slice(index + 1), size - 1).map((rest) => [card, ...rest]),
  );
}

function legalActions(state: HeartsState, playerId: PlayerId): readonly HeartsActionPayload[] {
  const seat = seatOf(state, playerId);
  const hand = seat === null ? undefined : state.hands[seat];
  if (seat === null || hand === undefined) return [];
  if (state.phase === 'passing') {
    if (state.passSelections[seat] !== null) return [];
    return combinations(hand, HEARTS_PASS_COUNT).map((cards) => ({
      type: 'pass_cards',
      cardIds: cards.map((card) => card.id),
    }));
  }
  if (state.phase !== 'playing' || state.currentTurnSeat !== seat) return [];
  return legalPlays(hand, {
    trick: state.trick,
    isFirstTrick: state.tricksPlayed === 0,
    heartsBroken: state.heartsBroken,
  }).map((card) => ({ type: 'play_card', cardId: card.id }));
}

// ---------------------------------------------------------------------------
// Aplicação de ações
// ---------------------------------------------------------------------------

function exchangeCards(state: HeartsState, selections: readonly (readonly HeartsCard[])[]) {
  const hands = state.hands.map((hand, seat) => {
    const given = new Set((selections[seat] ?? []).map((card) => card.id));
    const received = selections.flatMap((cards, from) =>
      passTargetSeat(from, state.passDirection) === seat ? cards : [],
    );
    return [...hand.filter((card) => !given.has(card.id)), ...received];
  });
  return enterPlaying({ ...state, hands });
}

function applyPass(
  state: HeartsState,
  seat: SeatIndex,
  cardIds: readonly string[],
): ApplyResult<HeartsState, HeartsEvent> {
  if (state.phase !== 'passing' || state.passSelections[seat] !== null) {
    return failure('not_your_turn', 'Este jogador não pode passar cartas agora.');
  }
  if (cardIds.length !== HEARTS_PASS_COUNT || new Set(cardIds).size !== HEARTS_PASS_COUNT) {
    return failure('invalid_setup', 'O passe exige 3 cartas diferentes.');
  }
  const hand = state.hands[seat] ?? [];
  const chosen = cardIds.flatMap((id) => hand.filter((card) => card.id === id));
  if (chosen.length !== HEARTS_PASS_COUNT) {
    return failure('card_not_in_hand', 'Uma das cartas não está na mão deste jogador.');
  }
  const passSelections = state.passSelections.map((selection, index) =>
    index === seat ? chosen : selection,
  );
  const events: HeartsEvent[] = [{ type: 'pass_confirmed', playerId: state.playerIds[seat] ?? '' }];
  const everyone = passSelections.filter((selection) => selection !== null);
  if (everyone.length < HEARTS_PLAYER_COUNT) {
    return { ok: true, state: { ...state, passSelections }, events };
  }
  events.push({ type: 'passing_completed' });
  return { ok: true, state: exchangeCards({ ...state, passSelections }, everyone), events };
}

function finishHand(state: HeartsState, events: HeartsEvent[]): HeartsState {
  const score = scoreHand(state.captured);
  const totals = state.totals.map((total, seat) => total + (score.points[seat] ?? 0));
  const standing = matchStanding(totals);
  events.push({
    type: 'hand_finished',
    points: score.points,
    moonShooter: score.moonShooter === null ? null : (state.playerIds[score.moonShooter] ?? null),
  });
  if (standing.finished) {
    events.push({
      type: 'game_finished',
      winners: standing.winners.map((seat) => state.playerIds[seat] ?? ''),
    });
  }
  return {
    ...state,
    phase: standing.finished ? 'finished' : 'hand_over',
    currentTurnSeat: null,
    totals,
    lastHandScore: score,
    winners: standing.winners,
  };
}

function applyPlay(
  state: HeartsState,
  seat: SeatIndex,
  cardId: string,
): ApplyResult<HeartsState, HeartsEvent> {
  if (state.phase !== 'playing' || state.currentTurnSeat !== seat) {
    return failure('not_your_turn', 'Não é o turno deste jogador.');
  }
  const hand = state.hands[seat] ?? [];
  const card = hand.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    return failure('card_not_in_hand', 'A carta não está na mão deste jogador.');
  }
  const allowed = legalPlays(hand, {
    trick: state.trick,
    isFirstTrick: state.tricksPlayed === 0,
    heartsBroken: state.heartsBroken,
  });
  if (!allowed.some((candidate) => candidate.id === cardId)) {
    return failure('invalid_setup', 'Essa carta não pode ser jogada agora.');
  }

  const playerId = state.playerIds[seat] ?? '';
  const events: HeartsEvent[] = [{ type: 'card_played', playerId, cardId }];
  const trick = [...state.trick, { seat, card }];
  const next: HeartsState = {
    ...state,
    hands: state.hands.map((h, index) => (index === seat ? h.filter((c) => c.id !== cardId) : h)),
    heartsBroken: state.heartsBroken || breaksHearts(card),
    trick,
    currentTurnSeat: (seat + 1) % HEARTS_PLAYER_COUNT,
  };
  if (trick.length < HEARTS_PLAYER_COUNT) {
    return { ok: true, state: next, events };
  }

  const winner = trickWinner(trick);
  events.push({
    type: 'trick_won',
    playerId: state.playerIds[winner] ?? '',
    points: trickPoints(trick),
  });
  const afterTrick: HeartsState = {
    ...next,
    trick: [],
    tricksPlayed: state.tricksPlayed + 1,
    captured: state.captured.map((cards, index) =>
      index === winner ? [...cards, ...trick.map((play) => play.card)] : cards,
    ),
    currentTurnSeat: winner,
  };
  if (afterTrick.tricksPlayed < TRICKS_PER_HAND) {
    return { ok: true, state: afterTrick, events };
  }
  return { ok: true, state: finishHand(afterTrick, events), events };
}

function applyAction(
  state: HeartsState,
  action: EngineAction<HeartsActionPayload>,
): ApplyResult<HeartsState, HeartsEvent> {
  if (state.phase === 'finished') {
    return failure('game_finished', 'A partida já terminou.');
  }
  const seat = seatOf(state, action.playerId);
  if (seat === null) {
    return failure('not_your_turn', 'Este jogador não pertence à partida.');
  }
  return action.payload.type === 'pass_cards'
    ? applyPass(state, seat, action.payload.cardIds)
    : applyPlay(state, seat, action.payload.cardId);
}

// ---------------------------------------------------------------------------
// Visões e resultado
// ---------------------------------------------------------------------------

function publicView(state: HeartsState): HeartsPublicView {
  const at = (seat: SeatIndex) => state.playerIds[seat] ?? '';
  return {
    gameId: 'hearts',
    phase: state.phase,
    handIndex: state.handIndex,
    passDirection: state.passDirection,
    currentTurnPlayerId: state.currentTurnSeat === null ? null : at(state.currentTurnSeat),
    handSizes: state.hands.map((hand, seat) => ({ playerId: at(seat), count: hand.length })),
    passConfirmed: state.passSelections.map((selection, seat) => ({
      playerId: at(seat),
      confirmed: selection !== null,
    })),
    trick: state.trick.map((play) => ({ playerId: at(play.seat), cardId: play.card.id })),
    heartsBroken: state.heartsBroken,
    totals: state.totals.map((total, seat) => ({ playerId: at(seat), total })),
    lastHandPoints: state.lastHandScore === null ? null : [...state.lastHandScore.points],
  };
}

function viewFor(state: HeartsState, playerId: PlayerId): HeartsPrivateView {
  const seat = seatOf(state, playerId);
  if (seat === null) {
    throw new UnknownPlayerError(playerId);
  }
  return {
    playerId,
    hand: [...(state.hands[seat] ?? [])],
    passSelection: state.passSelections[seat]?.map((card) => card.id) ?? null,
    legalActions: legalActions(state, playerId),
  };
}

function resultOf(state: HeartsState): HeartsResult | null {
  if (state.phase !== 'finished') return null;
  return {
    winners: state.winners.map((seat) => state.playerIds[seat] ?? ''),
    totals: [...state.totals],
  };
}

export const heartsGame: GameDefinition<
  HeartsState,
  HeartsActionPayload,
  HeartsPublicView,
  HeartsPrivateView,
  HeartsResult,
  HeartsEvent
> = {
  id: 'hearts',
  playerCount: PLAYER_COUNT,
  createInitialState,
  legalActions,
  applyAction,
  publicView,
  viewFor,
  resultOf,
};
