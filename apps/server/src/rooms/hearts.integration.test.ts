/**
 * Testes de integração da sala do Copas (doc 0003 §7, passo 4).
 *
 * Servidor Colyseus real e quatro clientes reais do SDK oficial, como no spike. A sala é a de
 * produção com `Rng` determinístico (`SeededHeartsRoom`). O que se observa é o que cada cliente
 * recebe: as asserções de informação oculta (critério S3) varrem o payload bruto de cada conexão.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusSDK } from '@colyseus/sdk';
import type { ColyseusTestServer } from '@colyseus/testing';
import {
  errorMessageSchema,
  heartsEventsMessageSchema,
  heartsStatePrivateMessageSchema,
  heartsStatePublicMessageSchema,
  joinAcceptedMessageSchema,
  type HeartsActionPayload,
  type HeartsStatePrivateMessage,
  type HeartsStatePublicMessage,
  type JoinAcceptedMessage,
} from '@cartas-na-mesa/protocol';

import {
  at,
  closeAllConnections,
  connectGuest,
  connectHost,
  rawJsonMatching,
  startTestServer,
  TEST_HEARTS_ROOM_NAME,
  type TestConnection,
} from './fixture.integration.helper';

/** Margem para as esperas por mensagem, que são o único ponto lento do teste. */
const TEST_TIMEOUT_MS = 30_000;

const NICKNAMES = ['Ana', 'Bia', 'Caio', 'Duda'] as const;

/** Uma mão completa tem 4 passes e 52 jogadas; o limite só impede o laço de não terminar. */
const MAX_HAND_STEPS = 100;

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

// As funções do helper do fixture que validam todas as mensagens usam os schemas do fixture; aqui
// cada mensagem é validada pelo schema do Copas, e só a que o teste lê.

function publicStates(connection: TestConnection): HeartsStatePublicMessage[] {
  return connection.messages.state_public.map((raw) => heartsStatePublicMessageSchema.parse(raw));
}

// As mensagens chegam em ordem de versão: a última é a mais recente.
function lastPublic(connection: TestConnection): HeartsStatePublicMessage {
  const raw = connection.messages.state_public;
  return heartsStatePublicMessageSchema.parse(at(raw, raw.length - 1, 'state_public'));
}

function lastPrivate(connection: TestConnection): HeartsStatePrivateMessage {
  const raw = connection.messages.state_private;
  return heartsStatePrivateMessageSchema.parse(at(raw, raw.length - 1, 'state_private'));
}

async function awaitAccepted(connection: TestConnection): Promise<JoinAcceptedMessage> {
  await connection.waitFor(
    () => connection.messages.join_accepted.length > 0,
    'a mensagem "join_accepted"',
  );
  return joinAcceptedMessageSchema.parse(at(connection.messages.join_accepted, 0, 'join_accepted'));
}

/**
 * Espera todas as conexões receberem o estado privado da versão pedida (ou de uma posterior). O
 * privado chega depois do público, então o público dessa versão já está no acumulado.
 */
async function awaitVersion(players: readonly TestConnection[], version: number): Promise<void> {
  for (const player of players) {
    await player.waitFor(
      () => player.messages.state_private.length > 0 && lastPrivate(player).version >= version,
      `o estado privado com version >= ${version}`,
    );
  }
}

function sendAction(
  connection: TestConnection,
  matchId: string,
  stateVersion: number,
  action: HeartsActionPayload,
): void {
  connection.room.send('action_intent', { type: 'action_intent', matchId, stateVersion, action });
}

interface Table {
  readonly players: readonly TestConnection[];
  readonly accepted: readonly JoinAcceptedMessage[];
  readonly matchId: string;
}

/** Monta a mesa como quatro jogadores fariam: o primeiro cria, os outros entram pelo código. */
async function seatTable(): Promise<Table> {
  const host = await connectHost(sdk, at(NICKNAMES, 0, 'apelido'), TEST_HEARTS_ROOM_NAME);
  const hostAccepted = await awaitAccepted(host);
  const players = [host];
  const accepted = [hostAccepted];

  for (const nickname of NICKNAMES.slice(1)) {
    const guest = await connectGuest(sdk, hostAccepted.roomCode, nickname);
    accepted.push(await awaitAccepted(guest));
    players.push(guest);
  }

  // A partida nasce com o quarto assento: todos recebem a visão inicial.
  await awaitVersion(players, 0);
  return { players, accepted, matchId: hostAccepted.matchId };
}

/**
 * Joga a mão inteira: a cada passo, o primeiro jogador com ação legal joga a primeira delas. Para
 * quando a mão termina, ou quando a sala já distribuiu a seguinte.
 */
async function playHand(table: Table): Promise<void> {
  const first = at(table.players, 0, 'jogador');
  let version = 0;

  for (let step = 0; step < MAX_HAND_STEPS; step += 1) {
    await awaitVersion(table.players, version);

    const { game } = lastPublic(first);
    if (game.phase === 'hand_over' || game.handIndex > 0) {
      return;
    }

    const actor = table.players.find((player) => lastPrivate(player).view.legalActions.length > 0);
    if (actor === undefined) {
      throw new Error(`Ninguém tem ação legal na versão ${version}.`);
    }
    const action = at(lastPrivate(actor).view.legalActions, 0, 'ação legal');
    sendAction(actor, table.matchId, version, action);
    version += 1;
  }

  throw new Error(`A mão não terminou em ${MAX_HAND_STEPS} passos.`);
}

describe('sala do Copas', () => {
  it(
    'inicia a partida quando o quarto jogador senta, com 13 cartas para cada um',
    async () => {
      const table = await seatTable();

      expect(new Set(table.accepted.map((accepted) => accepted.seatIndex)).size).toBe(4);

      for (const player of table.players) {
        const state = lastPublic(player);
        expect(state.version).toBe(0);
        expect(state.game.phase).toBe('passing');
        expect(state.game.handSizes.map((entry) => entry.count)).toEqual([13, 13, 13, 13]);
        expect(state.seats).toHaveLength(4);
        expect(state.seats.every((seat) => seat.kind === 'human' && seat.connected)).toBe(true);
        expect(lastPrivate(player).view.hand).toHaveLength(13);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'S3: nenhuma conexão recebe cartas da mão de outro jogador (payload bruto)',
    async () => {
      const table = await seatTable();
      const hands = table.players.map((player) =>
        lastPrivate(player).view.hand.map((card) => card.id),
      );

      table.players.forEach((player, index) => {
        const own = at(hands, index, 'mão');
        const foreign = hands.filter((_, other) => other !== index).flat();

        // A checagem de que a própria mão aparece impede que o teste passe por varrer o nada.
        expect(rawJsonMatching(player.messages, own)).toHaveLength(13);
        expect(rawJsonMatching(player.messages, foreign)).toEqual([]);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'o passe de um jogador é confirmado para todos, mas as cartas escolhidas só ficam com ele',
    async () => {
      const table = await seatTable();
      const host = at(table.players, 0, 'jogador');
      const hostId = at(table.accepted, 0, 'join_accepted').playerId;

      const action = at(lastPrivate(host).view.legalActions, 0, 'ação legal do passe');
      if (action.type !== 'pass_cards') {
        throw new Error('Na fase de passe, a ação legal deveria ser pass_cards.');
      }
      sendAction(host, table.matchId, 0, action);
      await awaitVersion(table.players, 1);

      expect(lastPrivate(host).view.passSelection).toEqual(action.cardIds);

      for (const player of table.players) {
        const { passConfirmed } = lastPublic(player).game;
        const confirmed = passConfirmed.filter((entry) => entry.confirmed);
        expect(confirmed.map((entry) => entry.playerId)).toEqual([hostId]);
      }

      for (const other of table.players.slice(1)) {
        expect(lastPrivate(other).view.passSelection).toBeNull();
        expect(rawJsonMatching(other.messages, action.cardIds)).toEqual([]);

        const events = other.messages.events.map((raw) => heartsEventsMessageSchema.parse(raw));
        expect(events.flatMap((message) => message.events)).toContainEqual({
          type: 'pass_confirmed',
          playerId: hostId,
        });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'jogada fora de hora vira erro só para o remetente e não muda a partida',
    async () => {
      const table = await seatTable();
      const bia = at(table.players, 1, 'jogador');
      const card = at(lastPrivate(bia).view.hand, 0, 'carta');

      // Na fase de passe ninguém joga carta.
      sendAction(bia, table.matchId, 0, { type: 'play_card', cardId: card.id });
      await bia.waitFor(() => bia.messages.error.length > 0, 'o erro da jogada fora de hora');

      const error = errorMessageSchema.parse(at(bia.messages.error, 0, 'error'));
      expect(error.code).toBe('not_your_turn');

      for (const player of table.players) {
        expect(publicStates(player).map((state) => state.version)).toEqual([0]);
        if (player !== bia) {
          expect(player.messages.error).toHaveLength(0);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'depois do fim da mão, a sala distribui a próxima mão e o placar é mantido',
    async () => {
      const table = await seatTable();

      await playHand(table);
      for (const player of table.players) {
        await player.waitFor(
          () => lastPublic(player).game.handIndex === 1,
          'a distribuição da segunda mão',
        );
      }

      for (const player of table.players) {
        const { game, version } = lastPublic(player);

        // 4 passes + 52 jogadas = versão 56 (fim da mão); a distribuição é a versão seguinte.
        expect(version).toBe(57);
        expect(game.phase).toBe('passing');
        expect(game.passDirection).toBe('right');
        expect(game.handSizes.map((entry) => entry.count)).toEqual([13, 13, 13, 13]);
        expect(game.passConfirmed.every((entry) => !entry.confirmed)).toBe(true);

        const points = game.lastHandPoints;
        if (points === null) {
          throw new Error('O placar da mão anterior deveria estar na visão pública.');
        }
        // 26 pontos na mão normal; 78 quando alguém vira a lua.
        expect([26, 78]).toContain(points.reduce((sum, value) => sum + value, 0));
        expect(game.totals.map((entry) => entry.total)).toEqual(points);

        const { view } = lastPrivate(player);
        expect(view.hand).toHaveLength(13);
        expect(view.passSelection).toBeNull();
        expect(view.legalActions.length).toBeGreaterThan(0);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
