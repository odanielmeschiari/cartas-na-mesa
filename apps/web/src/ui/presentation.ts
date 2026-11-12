import type {
  MatchResult,
  FixturePrivateView,
  FixturePublicView,
  SeatInfo,
} from '@cartas-na-mesa/protocol';

import type { SpikeClientSnapshot, SpikeClientStatus } from '../client/spike-client';

/**
 * Apresentação do snapshot: o que a tela mostra, em texto.
 *
 * Todas as funções aqui são **puras** — recebem o snapshot e devolvem texto e
 * listas prontas para exibir. Nenhuma delas decide regra de jogo: elas
 * traduzem o que o servidor disse (contrato §5). A separação existe para que
 * a apresentação possa ser testada sem React e sem rede.
 *
 * Regra de acessibilidade embutida: **nenhum estado depende só da cor**. O
 * turno e a presença são marcados por texto ("é o turno de Ana", "ausente"),
 * e as cartas da mão recebem rótulo textual ("Carta 1") e nome acessível
 * ("Jogar a carta 1 (c1)").
 */

/** Limite de caracteres do apelido (contrato §2: 1 a 24 depois do `trim`). */
export const NICKNAME_MAX_LENGTH = 24;

/** Um assento, pronto para exibição. */
export interface SeatDescription {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly nickname: string;
  /** Texto do avatar: o identificador opaco ou a marca de avatar padrão. */
  readonly avatarLabel: string;
  /** "presente" ou "ausente". */
  readonly presenceLabel: string;
  /** "é o turno de X" quando é o turno do assento; `null` caso contrário. */
  readonly turnLabel: string | null;
  /** Número de cartas na mão do assento; `null` se a partida não começou. */
  readonly handCount: number | null;
}

/** Tamanho da mão de um jogador, pronto para exibição. */
export interface HandSizeDescription {
  readonly nickname: string;
  readonly count: number;
  /** "2 cartas" — pluraliza para o texto fazer sentido sem cor. */
  readonly label: string;
}

/** Carta na mesa, pronta para exibição. */
export interface TableCardDescription {
  readonly nickname: string;
  readonly cardId: string;
  /** "Ana jogou a carta c1". */
  readonly label: string;
}

/** Estado público da partida, pronto para exibição. */
export interface PublicStateDescription {
  readonly statusLabel: string;
  readonly turnLabel: string;
  readonly handSizes: readonly HandSizeDescription[];
  readonly table: readonly TableCardDescription[];
  /** Texto do resultado, ou `null` enquanto a partida não termina. */
  readonly resultLabel: string | null;
}

/** Carta da mão do jogador, pronta para exibição. */
export interface HandCardDescription {
  readonly cardId: string;
  /** "Carta 1" — rótulo visível, que não depende de saber ler o `cardId`. */
  readonly label: string;
  /** "Jogar a carta 1 (c1)" — nome acessível do botão. */
  readonly accessibleName: string;
  /** true quando o servidor listou a jogada entre as ações legais. */
  readonly playable: boolean;
}

/** Visão privada do jogador, pronta para exibição. */
export interface PrivateStateDescription {
  readonly cards: readonly HandCardDescription[];
  readonly isEmpty: boolean;
  readonly emptyLabel: string;
}

/** A sala inteira, pronta para exibição. */
export interface RoomDescription {
  readonly roomCode: string | null;
  readonly matchId: string | null;
  readonly connectionLabel: string;
  readonly seats: readonly SeatDescription[];
  readonly publicState: PublicStateDescription | null;
  readonly privateState: PrivateStateDescription | null;
}

/**
 * Normaliza o código de sala digitado: sem espaços nas pontas e em
 * maiúsculas.
 *
 * O código é opaco para o cliente (contrato §2), mas o servidor o sorteia de um
 * alfabeto sem minúsculas, então maiúsculas não alteram o valor — só evitam
 * que a pessoa digite "abc123" e não encontre a sala.
 */
export function formatRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Texto do avatar de um assento. */
export function describeAvatar(avatarId: string | null): string {
  return avatarId === null ? 'avatar padrão' : `avatar ${avatarId}`;
}

/** Texto do estado da conexão, para a região de status da tela. */
export function describeConnection(status: SpikeClientStatus): string {
  switch (status) {
    case 'connecting':
      return 'Conectando ao servidor…';
    case 'waiting':
      return 'Aguardando o segundo jogador.';
    case 'playing':
      return 'Partida em andamento.';
    case 'reconnecting':
      return 'A conexão caiu. Reconectando…';
    case 'error':
      return 'A conexão com o servidor foi encerrada.';
    default:
      return 'Estado da conexão desconhecido.';
  }
}

/** Texto de quem tem o turno. */
export function describeTurn(
  currentTurnPlayerId: string | null,
  nameOf: (playerId: string) => string,
): string {
  if (currentTurnPlayerId === null) {
    return 'Nenhum turno ativo.';
  }

  return `É o turno de ${nameOf(currentTurnPlayerId)}.`;
}

/** Texto do resultado da partida. */
export function describeResult(result: MatchResult | null): string | null {
  if (result === null) {
    return null;
  }

  return 'Resultado: empate.';
}

/** Texto do tamanho da mão de um jogador. */
export function describeHandSize(nickname: string, count: number): HandSizeDescription {
  return {
    nickname,
    count,
    label: count === 1 ? '1 carta' : `${count} cartas`,
  };
}

/** Texto de uma carta jogada na mesa. */
export function describeTableCard(nickname: string, cardId: string): TableCardDescription {
  return {
    nickname,
    cardId,
    label: `${nickname} jogou a carta ${cardId}`,
  };
}

/**
 * Resolvedor de apelido por `playerId`.
 *
 * O `playerId` é opaco e só o servidor o conhece; a tela o usa apenas para
 * casar assento, turno, mão e mesa com o nome da pessoa.
 */
export function createNameResolver(seats: readonly SeatInfo[]): (playerId: string) => string {
  const names = new Map<string, string>();
  for (const seat of seats) {
    names.set(seat.playerId, seat.nickname);
  }

  return (playerId: string): string => names.get(playerId) ?? 'Jogador desconhecido';
}

/** Descrição de um assento. */
export function describeSeat(
  seat: SeatInfo,
  publicGame: FixturePublicView | null,
): SeatDescription {
  const isTurn = publicGame !== null && publicGame.currentTurnPlayerId === seat.playerId;
  const handCount =
    publicGame?.handSizes.find((entry) => entry.playerId === seat.playerId)?.count ?? null;

  return {
    playerId: seat.playerId,
    seatIndex: seat.seatIndex,
    nickname: seat.nickname,
    avatarLabel: describeAvatar(seat.avatarId),
    presenceLabel: seat.connected ? 'presente' : 'ausente',
    turnLabel: isTurn ? `é o turno de ${seat.nickname}` : null,
    handCount,
  };
}

/** Descrição do estado público da partida. */
export function describePublicState(
  game: FixturePublicView,
  nameOf: (playerId: string) => string,
): PublicStateDescription {
  return {
    statusLabel: game.status === 'playing' ? 'Em andamento' : 'Encerrada',
    turnLabel: describeTurn(game.currentTurnPlayerId, nameOf),
    handSizes: game.handSizes.map((entry) => describeHandSize(nameOf(entry.playerId), entry.count)),
    table: game.table.map((entry) => describeTableCard(nameOf(entry.playerId), entry.cardId)),
    resultLabel: describeResult(game.result),
  };
}

/**
 * Descrição da visão privada.
 *
 * A jogabilidade vem de `legalActions`, que o servidor calculou: a UI não
 * decide se a carta pode ser jogada, ela **mostra** o que o servidor
 * respondeu (regra 9).
 */
export function describePrivateState(view: FixturePrivateView): PrivateStateDescription {
  const playableCardIds = new Set(
    view.legalActions
      .filter((action) => action.type === 'play_card')
      .map((action) => action.cardId),
  );

  return {
    cards: view.hand.map((cardId, index) => ({
      cardId,
      label: `Carta ${index + 1}`,
      accessibleName: `Jogar a carta ${index + 1} (${cardId})`,
      playable: playableCardIds.has(cardId),
    })),
    isEmpty: view.hand.length === 0,
    emptyLabel: 'Sua mão está vazia.',
  };
}

/** Descrição completa da sala, a partir do snapshot do cliente. */
export function describeSnapshot(snapshot: SpikeClientSnapshot): RoomDescription {
  const nameOf = createNameResolver(snapshot.seats);

  return {
    roomCode: snapshot.roomCode,
    matchId: snapshot.matchId,
    connectionLabel: describeConnection(snapshot.status),
    seats: snapshot.seats.map((seat) => describeSeat(seat, snapshot.publicGame)),
    publicState:
      snapshot.publicGame === null ? null : describePublicState(snapshot.publicGame, nameOf),
    privateState: snapshot.privateView === null ? null : describePrivateState(snapshot.privateView),
  };
}
