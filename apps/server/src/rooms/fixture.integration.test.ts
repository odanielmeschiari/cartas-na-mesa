/**
 * Testes de integração do spike do servidor (ADR-001, critérios S1–S4).
 *
 * Os testes sobem um servidor Colyseus real e conectam **dois clientes reais**
 * do SDK oficial: nada é simulado. A sala é a mesma da produção, com a seed
 * fixa 42 (doc 0002 §4), o que torna a distribuição das cartas determinística
 * sem que o teste precise conhecer as cartas de antemão.
 *
 * O que se observa é **o que o cliente recebe**: as asserções nunca leem o
 * estado interno da sala. As mensagens recebidas são validadas pelos schemas
 * Zod de `@cartas-na-mesa/protocol`, o que prova ao mesmo tempo que o
 * servidor respeita o contrato e que o payload é bem formado.
 *
 * Critérios cobertos (docs/architecture/0001-fixture-contract.md §7):
 * - S1: duas conexões na mesma sala, pelo código.
 * - S2: estado autoritativo; ação inválida não muda nada e o erro é só do
 *   remetente.
 * - S3: informação oculta por jogador, verificada sobre o payload bruto.
 * - S4: reconexão após queda — o mesmo assento, a mesma mão, o mesmo estado de
 *   turno, sem assento duplicado e com o outro jogador vendo a ausência e o
 *   retorno.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusSDK, Room as SdkRoom } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import { matchMaker } from 'colyseus';
import {
  statePrivateMessageSchema,
  statePublicMessageSchema,
  type SeatInfo,
  type StatePrivateMessage,
  type StatePublicMessage,
} from '@cartas-na-mesa/protocol';

import {
  at,
  awaitError,
  awaitJoinAccepted,
  awaitStateVersion,
  closeAllConnections,
  connectGuest,
  connectGuestWhenAvailable,
  connectHost,
  connectWithoutIdentity,
  joinWithoutIdentity,
  lastStatePrivate,
  lastStatePublic,
  payloadValuesMatching,
  rawJsonMatching,
  setupMatch,
  startTestServer,
  stateVersions,
  stringValues,
  TEST_TIMEOUT_ROOM_NAME,
  validateMessages,
  waitFor,
  TestConnection,
} from './fixture.integration.helper';

/** Margem para as esperas por mensagem, que são o único ponto lento do teste. */
const TEST_TIMEOUT_MS = 20_000;

/** Código de encerramento que o servidor usa para a conexão sem identidade. */
const IDENTITY_TIMEOUT_CLOSE_CODE = 4000;

/** Motivo do encerramento que o servidor envia junto do código. */
const IDENTITY_TIMEOUT_REASON = 'identity_timeout';

let testServer: ColyseusTestServer;
let sdk: ColyseusSDK;

beforeAll(async () => {
  testServer = await startTestServer();
  sdk = testServer.sdk;
}, TEST_TIMEOUT_MS);

afterEach(async () => {
  await closeAllConnections();
});

afterAll(async () => {
  await testServer.shutdown();
});

/** Envia uma intenção de jogada bem formada (a validação é do servidor). */
function playCard(
  connection: TestConnection,
  matchId: string,
  stateVersion: number,
  cardId: string,
): void {
  connection.room.send('action_intent', {
    type: 'action_intent',
    matchId,
    stateVersion,
    action: { type: 'play_card', cardId },
  });
}

/**
 * Espera a conexão ser encerrada e devolve o código e o motivo do
 * encerramento. O tempo limite evita que o teste fique pendurado quando a
 * saída nunca acontece.
 */
function waitForLeave(
  room: SdkRoom,
  timeoutMs: number = 5_000,
): Promise<{ code: number; reason: string | undefined }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout de ${timeoutMs} ms esperando a conexão ser encerrada.`));
    }, timeoutMs);

    room.onLeave((code: number, reason?: string) => {
      clearTimeout(timer);
      resolve({ code, reason });
    });
  });
}

/**
 * `state_public` recebidos pela conexão, validados pelo schema do protocolo.
 *
 * O parse é tolerante de propósito: uma mensagem fora do contrato é ignorada
 * em vez de estourar, para que a espera nunca lance dentro do predicado.
 */
function publicStates(connection: TestConnection): StatePublicMessage[] {
  const states: StatePublicMessage[] = [];
  for (const raw of connection.messages.state_public) {
    const parsed = statePublicMessageSchema.safeParse(raw);
    if (parsed.success) {
      states.push(parsed.data);
    }
  }
  return states;
}

/** `state_private` recebidos pela conexão, validados pelo schema do protocolo. */
function privateStates(connection: TestConnection): StatePrivateMessage[] {
  const views: StatePrivateMessage[] = [];
  for (const raw of connection.messages.state_private) {
    const parsed = statePrivateMessageSchema.safeParse(raw);
    if (parsed.success) {
      views.push(parsed.data);
    }
  }
  return views;
}

/**
 * Assento do jogador no `state_public`, com erro descritivo quando o assento
 * não está na lista.
 */
function seatOf(state: StatePublicMessage, playerId: string): SeatInfo {
  const seat = state.seats.find((candidate) => candidate.playerId === playerId);
  if (seat === undefined) {
    throw new Error(
      `O "state_public" não traz assento para o jogador "${playerId}" ` +
        `(assentos: ${state.seats.map((candidate) => candidate.seatIndex).join(', ')}).`,
    );
  }
  return seat;
}

/**
 * Abre uma nova conexão na sala, repetindo o pedido de matchmaking até que a
 * vaga de conexão do Colyseus seja liberada.
 *
 * A conexão ainda não se identifica: quem assume a sessão de jogo é a
 * mensagem `reconnect`, enviada depois.
 */
async function openReconnectConnection(roomCode: string): Promise<SdkRoom> {
  let room: SdkRoom | undefined;
  let lastError: unknown;

  try {
    await waitFor(async () => {
      try {
        room = await joinWithoutIdentity(sdk, roomCode);
        return true;
      } catch (error) {
        // A vaga de conexão ainda não foi liberada: a espera é reavaliada.
        lastError = error;
        return false;
      }
    }, `a conexão de reconexão ser aceita na sala "${roomCode}"`);
  } catch (error) {
    throw new Error(
      `Não foi possível reconectar na sala "${roomCode}": ` +
        `${lastError instanceof Error ? lastError.message : String(error)}`,
      { cause: error },
    );
  }

  if (room === undefined) {
    throw new Error(`Não foi possível reconectar na sala "${roomCode}".`);
  }

  return room;
}

describe('S1 — duas conexões na mesma sala', () => {
  it(
    'cria a sala, devolve um código e aceita o segundo jogador pelo mesmo código',
    async () => {
      const host = await connectHost(sdk, 'Ana');
      const hostAccepted = await awaitJoinAccepted(host);

      // O código da sala é o identificador devolvido pelo matchmaking.
      expect(hostAccepted.roomCode).toBe(host.room.roomId);
      expect(hostAccepted.roomCode.length).toBeGreaterThan(0);
      expect(hostAccepted.matchId.length).toBeGreaterThan(0);

      const guest = await connectGuest(sdk, hostAccepted.roomCode, 'Bia');
      const guestAccepted = await awaitJoinAccepted(guest);

      // Mesma sala e mesma partida; jogadores e assentos distintos.
      expect(guestAccepted.roomCode).toBe(hostAccepted.roomCode);
      expect(guestAccepted.matchId).toBe(hostAccepted.matchId);
      expect(guestAccepted.playerId).not.toBe(hostAccepted.playerId);
      expect(guestAccepted.seatIndex).not.toBe(hostAccepted.seatIndex);
      expect(new Set([hostAccepted.seatIndex, guestAccepted.seatIndex])).toEqual(new Set([0, 1]));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'não publica estado de partida antes do segundo assento',
    async () => {
      const host = await connectHost(sdk, 'Ana');
      await host.waitFor(() => host.messages.room_waiting.length > 0, 'a mensagem "room_waiting"');

      const waiting = at(validateMessages(host.messages).room_waiting, 0, 'room_waiting');
      const onlySeat = at(waiting.seats, 0, 'room_waiting.seats');
      expect(waiting.seats).toHaveLength(1);
      expect(onlySeat.seatIndex).toBe(0);
      expect(onlySeat.nickname).toBe('Ana');
      expect(onlySeat.connected).toBe(true);

      // Sem o segundo assento não existe partida: nem estado público nem privado.
      expect(host.messages.state_public).toEqual([]);
      expect(host.messages.state_private).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'publica o mesmo estado público, com exatamente dois assentos, para os dois jogadores',
    async () => {
      const { host, guest } = await setupMatch(sdk);

      const hostState = at(validateMessages(host.messages).state_public, 0, 'state_public de Ana');
      const guestState = at(
        validateMessages(guest.messages).state_public,
        0,
        'state_public de Bia',
      );

      expect(hostState.seats).toHaveLength(2);
      expect(guestState.seats).toHaveLength(2);
      expect(hostState.seats.map((seat) => seat.seatIndex)).toEqual([0, 1]);
      expect(hostState.seats.map((seat) => seat.nickname)).toEqual(['Ana', 'Bia']);
      expect(hostState.seats.every((seat) => seat.connected)).toBe(true);

      // O estado público é idêntico para todo mundo (doc 0002 §1).
      expect(guestState).toEqual(hostState);
      expect(guestState.matchId).toBe(hostState.matchId);
      expect(guestState.roomCode).toBe(hostState.roomCode);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('S2 — estado autoritativo', () => {
  it(
    'aplica a ação válida no servidor e faz os dois clientes convergirem',
    async () => {
      const { host, guest, hostAccepted, matchId } = await setupMatch(sdk);

      const before = lastStatePublic(host);
      expect(before.version).toBe(0);

      // Só o jogador do turno tem ações legais, e elas são as cartas da mão.
      const hostView = lastStatePrivate(host);
      expect(hostView.view.legalActions.map((action) => action.cardId)).toEqual([
        ...hostView.view.hand,
      ]);
      expect(lastStatePrivate(guest).view.legalActions).toEqual([]);

      const cardId = at(hostView.view.hand, 0, 'a mão de Ana');
      playCard(host, matchId, before.version, cardId);

      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      const hostAfter = lastStatePublic(host);
      const guestAfter = lastStatePublic(guest);

      // Os dois clientes convergem para o mesmo estado, com a versão incrementada.
      expect(hostAfter.version).toBe(1);
      expect(guestAfter.version).toBe(1);
      expect(guestAfter).toEqual(hostAfter);
      expect(hostAfter.game.status).toBe('playing');
      expect(hostAfter.game.table).toEqual([{ playerId: hostAccepted.playerId, cardId }]);

      // A visão privada do dono perde a carta; a do oponente permanece a sua.
      expect(lastStatePrivate(host).view.hand).not.toContain(cardId);
      expect(lastStatePrivate(guest).view.hand).toHaveLength(2);

      // O servidor emite o evento da jogada.
      const events = at(validateMessages(host.messages).events, 0, 'events');
      expect(events.version).toBe(1);
      expect(events.events).toContainEqual({
        type: 'card_played',
        playerId: hostAccepted.playerId,
        cardId,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita ação fora do turno com not_your_turn, só para o remetente',
    async () => {
      const { host, guest, matchId } = await setupMatch(sdk);

      // Não é o turno de Bia: suas ações legais são vazias.
      expect(lastStatePrivate(guest).view.legalActions).toEqual([]);
      const guestCard = at(lastStatePrivate(guest).view.hand, 0, 'a mão de Bia');
      const hostCard = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');

      playCard(guest, matchId, 0, guestCard);

      const error = await awaitError(guest, 'o erro "not_your_turn" para a jogada fora do turno');
      expect(error.code).toBe('not_your_turn');
      expect(error.message.length).toBeGreaterThan(0);

      // Barreira de sincronização: o erro só é enviado depois que o servidor
      // processou (e recusou) a ação, então a jogada válida de Ana é processada
      // depois dela.
      playCard(host, matchId, 0, hostCard);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      // A ação recusada não alterou o estado de nenhum cliente.
      expect(stateVersions(host)).toEqual([0, 1]);
      expect(stateVersions(guest)).toEqual([0, 1]);
      expect(lastStatePublic(host).game.table).toHaveLength(1);
      expect(lastStatePublic(guest).game.table).toEqual(lastStatePublic(host).game.table);

      // O erro foi só para quem o provocou.
      expect(guest.messages.error).toHaveLength(1);
      expect(host.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita carta que não está na mão do remetente com card_not_in_hand, só para o remetente',
    async () => {
      const { host, guest, hostAccepted, matchId } = await setupMatch(sdk);

      // Ana está no turno, mas tenta jogar uma carta de Bia.
      const guestCard = at(lastStatePrivate(guest).view.hand, 0, 'a mão de Bia');
      const hostCard = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');

      playCard(host, matchId, 0, guestCard);

      const error = await awaitError(host, 'o erro "card_not_in_hand" para a carta alheia');
      expect(error.code).toBe('card_not_in_hand');
      expect(error.message.length).toBeGreaterThan(0);
      // A mensagem de erro é texto de exibição: não ecoa a carta.
      expect(error.message).not.toContain(guestCard);

      // Barreira de sincronização: a jogada válida de Ana vem depois do erro.
      playCard(host, matchId, 0, hostCard);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      // A ação recusada não alterou o estado de nenhum cliente.
      expect(stateVersions(host)).toEqual([0, 1]);
      expect(stateVersions(guest)).toEqual([0, 1]);
      expect(lastStatePublic(host).game.table).toEqual([
        { playerId: hostAccepted.playerId, cardId: hostCard },
      ]);
      expect(lastStatePublic(guest).game.table).toEqual(lastStatePublic(host).game.table);

      // O erro foi só para quem o provocou.
      expect(host.messages.error).toHaveLength(1);
      expect(guest.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita stateVersion desatualizada com stale_state, só para o remetente',
    async () => {
      const { host, guest, matchId } = await setupMatch(sdk);

      const firstCard = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');
      const secondCard = at(lastStatePrivate(host).view.hand, 1, 'a mão de Ana');

      // Primeira jogada válida: a versão vai de 0 para 1 e o turno passa para Bia.
      playCard(host, matchId, 0, firstCard);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      // Ana reenvia a versão antiga (0), agora desatualizada.
      playCard(host, matchId, 0, secondCard);

      const error = await awaitError(host, 'o erro "stale_state" para a versão desatualizada');
      expect(error.code).toBe('stale_state');
      expect(error.message.length).toBeGreaterThan(0);

      // Barreira de sincronização: agora é o turno de Bia, que joga com a versão 1.
      const guestCard = at(lastStatePrivate(guest).view.hand, 0, 'a mão de Bia');
      playCard(guest, matchId, 1, guestCard);
      await awaitStateVersion(host, 2);
      await awaitStateVersion(guest, 2);

      // A ação recusada não alterou o estado de nenhum cliente.
      expect(stateVersions(host)).toEqual([0, 1, 2]);
      expect(stateVersions(guest)).toEqual([0, 1, 2]);
      expect(lastStatePublic(host).game.table).toHaveLength(2);
      expect(lastStatePublic(guest).game.table).toEqual(lastStatePublic(host).game.table);

      // O erro foi só para quem o provocou.
      expect(host.messages.error).toHaveLength(1);
      expect(guest.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita matchId de outra partida com match_not_found, só para o remetente',
    async () => {
      const { host, guest, hostAccepted, matchId } = await setupMatch(sdk);

      const cardId = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');

      host.room.send('action_intent', {
        type: 'action_intent',
        matchId: 'partida-de-outra-sala',
        stateVersion: 0,
        action: { type: 'play_card', cardId },
      });

      const error = await awaitError(host, 'o erro "match_not_found" para o matchId errado');
      expect(error.code).toBe('match_not_found');
      expect(error.message.length).toBeGreaterThan(0);

      // Barreira de sincronização: a partida real continua jogável.
      playCard(host, matchId, 0, cardId);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      // A ação recusada não alterou o estado de nenhum cliente.
      expect(stateVersions(host)).toEqual([0, 1]);
      expect(stateVersions(guest)).toEqual([0, 1]);
      expect(lastStatePublic(host).game.table).toEqual([
        { playerId: hostAccepted.playerId, cardId },
      ]);

      // O erro foi só para quem o provocou.
      expect(host.messages.error).toHaveLength(1);
      expect(guest.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita ação sem cardId com invalid_payload e mantém a conexão viva',
    async () => {
      const { host, guest, matchId } = await setupMatch(sdk);

      host.room.send('action_intent', {
        type: 'action_intent',
        matchId,
        stateVersion: 0,
        action: { type: 'play_card' },
      });

      const error = await awaitError(host, 'o erro "invalid_payload" para a ação sem cardId');
      expect(error.code).toBe('invalid_payload');
      expect(error.message.length).toBeGreaterThan(0);

      // Barreira de sincronização: a conexão continua viva e a jogada é aceita.
      const cardId = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');
      playCard(host, matchId, 0, cardId);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      // A ação recusada não alterou o estado de nenhum cliente.
      expect(stateVersions(host)).toEqual([0, 1]);
      expect(stateVersions(guest)).toEqual([0, 1]);
      expect(lastStatePublic(host).game.table).toHaveLength(1);

      // O erro foi só para quem o provocou.
      expect(host.messages.error).toHaveLength(1);
      expect(guest.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejeita playerId injetado no payload da ação com invalid_payload',
    async () => {
      const { host, guest, hostAccepted, guestAccepted, matchId } = await setupMatch(sdk);

      const cardId = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');

      // Ana tenta jogar em nome de Bia: o playerId nunca vem do cliente.
      host.room.send('action_intent', {
        type: 'action_intent',
        matchId,
        stateVersion: 0,
        action: { type: 'play_card', cardId, playerId: guestAccepted.playerId },
      });

      const error = await awaitError(host, 'o erro "invalid_payload" para o playerId injetado');
      expect(error.code).toBe('invalid_payload');

      // Barreira de sincronização: quem jogou foi Ana, resolvido pela sessão.
      playCard(host, matchId, 0, cardId);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      expect(lastStatePublic(host).game.table).toEqual([
        { playerId: hostAccepted.playerId, cardId },
      ]);
      expect(lastStatePublic(guest).game.table).toEqual(lastStatePublic(host).game.table);

      // O erro foi só para quem o provocou.
      expect(host.messages.error).toHaveLength(1);
      expect(guest.messages.error).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('S3 — informação oculta por jogador', () => {
  it(
    'entrega a mão só ao dono: nenhum identificador da mão alheia chega ao outro jogador',
    async () => {
      const { host, guest, hostAccepted, guestAccepted } = await setupMatch(sdk);

      const hostView = lastStatePrivate(host);
      const guestView = lastStatePrivate(guest);

      // Cada jogador recebe a visão privada com a própria identidade e a mão.
      expect(hostView.view.playerId).toBe(hostAccepted.playerId);
      expect(guestView.view.playerId).toBe(guestAccepted.playerId);
      expect(hostView.view.hand).toHaveLength(2);
      expect(guestView.view.hand).toHaveLength(2);
      // As mãos são distintas e, juntas, cobrem o baralho inteiro.
      expect(new Set([...hostView.view.hand, ...guestView.view.hand]).size).toBe(4);

      // Varredura estrutural do payload bruto recebido por cada conexão:
      // nenhum valor de string, em nenhuma profundidade, é uma carta da mão alheia.
      expect(payloadValuesMatching(host.messages, guestView.view.hand)).toEqual([]);
      expect(payloadValuesMatching(guest.messages, hostView.view.hand)).toEqual([]);

      // Varredura do JSON bruto de todas as mensagens recebidas por cada conexão.
      expect(rawJsonMatching(host.messages, guestView.view.hand)).toEqual([]);
      expect(rawJsonMatching(guest.messages, hostView.view.hand)).toEqual([]);

      // Controle positivo: o dono enxerga a própria mão.
      expect(new Set(payloadValuesMatching(host.messages, hostView.view.hand))).toEqual(
        new Set(hostView.view.hand),
      );
      expect(new Set(payloadValuesMatching(guest.messages, guestView.view.hand))).toEqual(
        new Set(guestView.view.hand),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'não expõe nenhuma carta no estado público: só o tamanho das mãos e a mesa',
    async () => {
      const { host, guest } = await setupMatch(sdk);

      const cardIds = [
        ...new Set([...lastStatePrivate(host).view.hand, ...lastStatePrivate(guest).view.hand]),
      ];

      const publicState = lastStatePublic(host);
      expect(publicState.game.handSizes).toHaveLength(2);
      expect(publicState.game.handSizes.map((entry) => entry.count)).toEqual([2, 2]);
      expect(publicState.game.table).toEqual([]);

      // O payload público, sozinho, não carrega nenhum identificador de carta.
      const publicStrings = stringValues(host.messages.state_public);
      expect(publicStrings.filter((value) => cardIds.includes(value))).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'depois de uma jogada, a mão restante de cada um continua invisível para o outro',
    async () => {
      const { host, guest, hostAccepted, matchId } = await setupMatch(sdk);

      const played = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');

      playCard(host, matchId, 0, played);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      const hostHandAfter = lastStatePrivate(host).view.hand;
      const guestHandAfter = lastStatePrivate(guest).view.hand;

      // A carta jogada sai da mão de Ana e vira pública na mesa.
      expect(hostHandAfter).not.toContain(played);
      expect(guestHandAfter).not.toContain(played);
      expect(lastStatePublic(guest).game.table).toEqual([
        { playerId: hostAccepted.playerId, cardId: played },
      ]);

      // As cartas que continuam na mão de um não aparecem no payload bruto do outro.
      expect(payloadValuesMatching(host.messages, guestHandAfter)).toEqual([]);
      expect(payloadValuesMatching(guest.messages, hostHandAfter)).toEqual([]);
      expect(rawJsonMatching(host.messages, guestHandAfter)).toEqual([]);
      expect(rawJsonMatching(guest.messages, hostHandAfter)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('Reconexão — uma sessão por conexão', () => {
  it(
    'recusa reconnect com o token de outra sessão e não entrega a mão alheia ao dono da outra sessão',
    async () => {
      const { host, guest, hostAccepted, guestAccepted, matchId } = await setupMatch(sdk);

      const hostHand = lastStatePrivate(host).view.hand;
      const guestHand = lastStatePrivate(guest).view.hand;

      // Ana, dona da sessão 1, apresenta o token da Bia, dona da sessão 2.
      host.room.send('reconnect', {
        type: 'reconnect',
        roomCode: guestAccepted.roomCode,
        sessionToken: guestAccepted.sessionToken,
      });

      const error = await awaitError(host, 'o erro "session_invalid" para o token de outra sessão');
      expect(error.code).toBe('session_invalid');
      expect(error.message.length).toBeGreaterThan(0);

      // A visão privada da Bia não vazou para a conexão da Ana: nem no payload
      // estruturado, nem no JSON bruto de tudo que a conexão recebeu.
      expect(payloadValuesMatching(host.messages, guestHand)).toEqual([]);
      expect(rawJsonMatching(host.messages, guestHand)).toEqual([]);

      // Toda visão privada recebida pela Ana é a da própria sessão.
      const hostViews = validateMessages(host.messages).state_private;
      expect(hostViews.length).toBeGreaterThan(0);
      for (const view of hostViews) {
        expect(view.view.playerId).toBe(hostAccepted.playerId);
      }

      // A identidade da Bia não foi reatribuída à conexão da Ana.
      for (const accepted of validateMessages(host.messages).join_accepted) {
        expect(accepted.playerId).toBe(hostAccepted.playerId);
      }

      // A recusa não mudou o estado público de ninguém.
      expect(stateVersions(host)).toEqual([0]);
      expect(stateVersions(guest)).toEqual([0]);

      // Barreira de sincronização: a partida continua jogável e a sessão da
      // Bia segue intacta (a jogada da Ana é processada depois do erro).
      const cardId = at(hostHand, 0, 'a mão de Ana');
      playCard(host, matchId, 0, cardId);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      const guestView = lastStatePrivate(guest);
      expect(guestView.view.playerId).toBe(guestAccepted.playerId);
      expect(guestView.view.hand).toHaveLength(2);
      expect(lastStatePublic(guest)).toEqual(lastStatePublic(host));
    },
    TEST_TIMEOUT_MS,
  );
});

describe('S4 — reconexão após queda', () => {
  it(
    'reconecta ao mesmo assento, com a mesma mão e o mesmo estado de turno, sem assento duplicado',
    async () => {
      const { host, guest, hostAccepted, guestAccepted, matchId, roomCode } = await setupMatch(sdk);

      // Estado da partida antes da queda: a mão de Ana, o turno e a versão.
      const privateBefore = lastStatePrivate(host);
      const publicBefore = lastStatePublic(host);
      const guestHandBefore = lastStatePrivate(guest).view.hand;

      expect(privateBefore.view.playerId).toBe(hostAccepted.playerId);
      expect(privateBefore.view.hand).toHaveLength(2);
      expect(publicBefore.version).toBe(0);
      expect(publicBefore.game.currentTurnPlayerId).toBe(hostAccepted.playerId);
      expect(publicBefore.seats).toHaveLength(2);
      expect(publicBefore.seats.every((seat) => seat.connected)).toBe(true);

      // A conexão de Ana é encerrada. Para o servidor, uma queda e uma saída
      // solicitada chegam pelo mesmo caminho (`onLeave`): a sessão de jogo é
      // desvinculada e a presença é republicada.
      const hostLeave = waitForLeave(host.room);
      await host.room.leave();
      await hostLeave;

      // Bia observa Ana ausente: o assento é preservado, a presença não.
      await guest.waitFor(
        () =>
          publicStates(guest).some(
            (state) =>
              state.seats.length === 2 &&
              state.seats.some(
                (seat) => seat.playerId === hostAccepted.playerId && seat.connected === false,
              ),
          ),
        'Bia observar Ana ausente no "state_public"',
      );

      const absentStates = publicStates(guest).filter(
        (state) =>
          state.seats.length === 2 &&
          state.seats.some(
            (seat) => seat.playerId === hostAccepted.playerId && seat.connected === false,
          ),
      );
      const absentState = at(
        absentStates,
        absentStates.length - 1,
        'o "state_public" com Ana ausente',
      );

      // O assento de Ana continua na sala, com o mesmo jogador e o mesmo
      // lugar; só a presença mudou.
      expect(absentState.seats).toHaveLength(2);
      expect(absentState.seats.map((seat) => seat.seatIndex)).toEqual([0, 1]);
      expect(seatOf(absentState, hostAccepted.playerId).connected).toBe(false);
      expect(seatOf(absentState, hostAccepted.playerId).seatIndex).toBe(hostAccepted.seatIndex);
      expect(seatOf(absentState, guestAccepted.playerId).connected).toBe(true);

      // A queda não alterou a partida: mesma versão, mesmo turno, mesma mesa.
      expect(absentState.version).toBe(publicBefore.version);
      expect(absentState.game.currentTurnPlayerId).toBe(publicBefore.game.currentTurnPlayerId);
      expect(absentState.game.table).toEqual(publicBefore.game.table);

      // Ana volta: nova conexão, mesmo código de sala, mesmo token de sessão.
      const reconnectRoom = await openReconnectConnection(roomCode);
      const reconnected = new TestConnection(reconnectRoom);
      reconnectRoom.send('reconnect', {
        type: 'reconnect',
        roomCode,
        sessionToken: hostAccepted.sessionToken,
      });

      await reconnected.waitFor(
        () => reconnected.messages.join_accepted.length > 0,
        'o "join_accepted" da reconexão',
      );

      const reaccepted = at(
        validateMessages(reconnected.messages).join_accepted,
        0,
        'join_accepted da reconexão',
      );

      // Mesma identidade, mesmo assento e mesmo token de sessão.
      expect(reaccepted.playerId).toBe(hostAccepted.playerId);
      expect(reaccepted.seatIndex).toBe(hostAccepted.seatIndex);
      expect(reaccepted.sessionToken).toBe(hostAccepted.sessionToken);
      expect(reaccepted.matchId).toBe(hostAccepted.matchId);
      expect(reaccepted.roomCode).toBe(roomCode);

      await reconnected.waitFor(
        () => publicStates(reconnected).length > 0 && privateStates(reconnected).length > 0,
        'o estado público e a visão privada da reconexão',
      );

      const privateAfter = lastStatePrivate(reconnected);
      const publicAfter = lastStatePublic(reconnected);

      // A mesma mão: mesmas cartas, mesma ordem.
      expect(privateAfter.view.playerId).toBe(hostAccepted.playerId);
      expect(privateAfter.view.hand).toEqual(privateBefore.view.hand);

      // O mesmo estado de turno e a mesma versão: a queda não mexeu na partida.
      expect(publicAfter.version).toBe(publicBefore.version);
      expect(publicAfter.game.currentTurnPlayerId).toBe(publicBefore.game.currentTurnPlayerId);
      expect(publicAfter.game.table).toEqual(publicBefore.game.table);
      expect(publicAfter.game.handSizes).toEqual(publicBefore.game.handSizes);

      // A sala continua com 2 jogadores e sem assento duplicado.
      expect(publicAfter.seats).toHaveLength(2);
      expect(publicAfter.seats.map((seat) => seat.seatIndex)).toEqual([0, 1]);
      expect(new Set(publicAfter.seats.map((seat) => seat.playerId)).size).toBe(2);
      expect(new Set(publicAfter.seats.map((seat) => seat.seatIndex)).size).toBe(2);
      expect(seatOf(publicAfter, hostAccepted.playerId).connected).toBe(true);
      expect(seatOf(publicAfter, guestAccepted.playerId).connected).toBe(true);

      // Bia observa Ana presente de novo.
      await guest.waitFor(
        () =>
          publicStates(guest).some(
            (state) =>
              state.seats.length === 2 &&
              state.seats.some(
                (seat) => seat.playerId === hostAccepted.playerId && seat.connected === true,
              ),
          ),
        'Bia observar Ana presente de novo no "state_public"',
      );

      const presentStates = publicStates(guest).filter(
        (state) =>
          state.seats.length === 2 &&
          state.seats.some(
            (seat) => seat.playerId === hostAccepted.playerId && seat.connected === true,
          ),
      );
      const presentState = at(
        presentStates,
        presentStates.length - 1,
        'o "state_public" com Ana presente de novo',
      );

      expect(presentState.seats).toHaveLength(2);
      expect(presentState.seats.map((seat) => seat.seatIndex)).toEqual([0, 1]);
      expect(seatOf(presentState, hostAccepted.playerId).connected).toBe(true);
      expect(presentState.version).toBe(publicBefore.version);
      expect(presentState.game.currentTurnPlayerId).toBe(publicBefore.game.currentTurnPlayerId);

      // A sessão da Bia não foi trocada: ela continua com a própria mão, e a
      // mão dela não vazou para a conexão reconectada da Ana.
      expect(lastStatePrivate(guest).view.playerId).toBe(guestAccepted.playerId);
      expect(lastStatePrivate(guest).view.hand).toEqual(guestHandBefore);
      expect(payloadValuesMatching(reconnected.messages, guestHandBefore)).toEqual([]);

      // Barreira de sincronização: a partida continua jogável depois da
      // reconexão, e os dois clientes convergem para o mesmo estado.
      const cardId = at(lastStatePrivate(reconnected).view.hand, 0, 'a mão de Ana reconectada');
      playCard(reconnected, matchId, publicAfter.version, cardId);

      await awaitStateVersion(reconnected, 1);
      await awaitStateVersion(guest, 1);

      expect(lastStatePublic(reconnected).version).toBe(publicBefore.version + 1);
      expect(lastStatePublic(reconnected).game.table).toEqual([
        { playerId: hostAccepted.playerId, cardId },
      ]);
      expect(lastStatePublic(guest).game.table).toEqual(lastStatePublic(reconnected).game.table);
      expect(lastStatePublic(guest)).toEqual(lastStatePublic(reconnected));
    },
    TEST_TIMEOUT_MS,
  );
});

describe('Ciclo de vida da sala', () => {
  it(
    'descarta a sala vazia sem partida iniciada',
    async () => {
      const host = await connectHost(sdk, 'Ana');
      const hostAccepted = await awaitJoinAccepted(host);
      const roomCode = hostAccepted.roomCode;

      // A sala existe no matchmaking enquanto o jogador está conectado.
      expect(await matchMaker.getRoomById(roomCode)).toBeDefined();

      // O jogador sai sem que a partida comece (ninguém sentou no segundo
      // assento): a sala não tem mais o que preservar.
      await host.room.leave();

      await waitFor(
        async () => (await matchMaker.getRoomById(roomCode)) === undefined,
        `a sala "${roomCode}" ser descartada do matchmaking`,
      );

      expect(await matchMaker.getRoomById(roomCode)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'descarta a sala vazia sem identidade e sem partida',
    async () => {
      // A sala é criada, mas a conexão nunca informa a identidade: não há
      // sessão de jogo, assento nem partida a preservar.
      const room = await connectWithoutIdentity(sdk);
      const roomCode = room.roomId;

      expect(await matchMaker.getRoomById(roomCode)).toBeDefined();

      // A conexão sai. Sem o descarte explícito, a sala ficaria registrada no
      // matchmaking para sempre (com `autoDispose` desligado, o Colyseus não
      // descarta a sala vazia por conta própria).
      await room.leave();

      await waitFor(
        async () => (await matchMaker.getRoomById(roomCode)) === undefined,
        `a sala "${roomCode}" ser descartada do matchmaking`,
      );

      expect(await matchMaker.getRoomById(roomCode)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});

describe('Prazo de identidade — a conexão sem identidade não segura a sala', () => {
  it(
    'encerra a conexão sem identidade quando o prazo expira e libera a vaga do jogador legítimo',
    async () => {
      // O primeiro jogador ocupa o assento 0.
      const host = await connectHost(sdk, 'Ana', TEST_TIMEOUT_ROOM_NAME);
      const hostAccepted = await awaitJoinAccepted(host);
      const roomCode = hostAccepted.roomCode;

      let hostLeft = false;
      host.room.onLeave(() => {
        hostLeft = true;
      });

      // Uma segunda conexão entra sem se identificar: consome a última vaga de
      // conexão do Colyseus sem ocupar nenhum assento de jogo.
      const intruder = await joinWithoutIdentity(sdk, roomCode);
      const intruderLeave = waitForLeave(intruder);

      // O jogador legítimo é barrado no matchmaking: há assento de jogo livre,
      // mas não há vaga de conexão.
      await expect(sdk.joinById(roomCode)).rejects.toThrow(/is locked|is already full/);

      // O prazo de identidade expira: a conexão sem identidade é encerrada
      // pelo servidor.
      const leave = await intruderLeave;
      expect(leave.code).toBe(IDENTITY_TIMEOUT_CLOSE_CODE);
      expect(leave.reason).toBe(IDENTITY_TIMEOUT_REASON);

      // A conexão que já se identificou não foi encerrada: o prazo vale só
      // para quem não se identificou.
      expect(hostLeft).toBe(false);
      expect(host.messages.error).toEqual([]);

      // A vaga foi liberada: o jogador legítimo entra e senta no segundo
      // assento.
      const guest = await connectGuestWhenAvailable(sdk, roomCode, 'Bia');
      const guestAccepted = await awaitJoinAccepted(guest);
      expect(guestAccepted.seatIndex).toBe(1);
      expect(guestAccepted.matchId).toBe(hostAccepted.matchId);

      await awaitStateVersion(host, 0);
      await awaitStateVersion(guest, 0);

      // A partida continua jogável depois do prazo de identidade.
      const cardId = at(lastStatePrivate(host).view.hand, 0, 'a mão de Ana');
      playCard(host, guestAccepted.matchId, 0, cardId);
      await awaitStateVersion(host, 1);
      await awaitStateVersion(guest, 1);

      expect(lastStatePublic(host).game.table).toHaveLength(1);
      expect(lastStatePublic(guest)).toEqual(lastStatePublic(host));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'encerra as duas conexões sem identidade quando o prazo expira e descarta a sala vazia',
    async () => {
      const roomA = await connectWithoutIdentity(sdk, TEST_TIMEOUT_ROOM_NAME);
      const roomCode = roomA.roomId;
      const leaveA = waitForLeave(roomA);

      // A segunda conexão sem identidade também é aceita: há vaga de conexão.
      const roomB = await joinWithoutIdentity(sdk, roomCode);
      const leaveB = waitForLeave(roomB);

      const closedA = await leaveA;
      expect(closedA.code).toBe(IDENTITY_TIMEOUT_CLOSE_CODE);
      expect(closedA.reason).toBe(IDENTITY_TIMEOUT_REASON);

      const closedB = await leaveB;
      expect(closedB.code).toBe(IDENTITY_TIMEOUT_CLOSE_CODE);
      expect(closedB.reason).toBe(IDENTITY_TIMEOUT_REASON);

      // A sala ficou vazia e nunca teve partida: é descartada do matchmaking.
      await waitFor(
        async () => (await matchMaker.getRoomById(roomCode)) === undefined,
        `a sala "${roomCode}" ser descartada do matchmaking`,
      );

      expect(await matchMaker.getRoomById(roomCode)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});
