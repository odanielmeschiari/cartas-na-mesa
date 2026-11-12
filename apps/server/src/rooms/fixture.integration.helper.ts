/**
 * Harness dos testes de integração do spike (S1–S3).
 *
 * Sobe um servidor Colyseus real, conecta clientes reais do SDK oficial e
 * acumula **todas** as mensagens recebidas por conexão. As asserções do
 * critério S3 são feitas sobre esse acumulado — o "payload bruto" que o
 * ADR-001 exige — e não apenas sobre campos conhecidos do contrato.
 *
 * Arquivo de teste: não é importado por código de produção.
 */

import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { ColyseusSDK, Room } from '@colyseus/sdk';
import { z } from 'zod';
import {
  errorMessageSchema,
  eventsMessageSchema,
  joinAcceptedMessageSchema,
  roomWaitingMessageSchema,
  statePrivateMessageSchema,
  statePublicMessageSchema,
  type ErrorMessage,
  type EventsMessage,
  type JoinAcceptedMessage,
  type RoomWaitingMessage,
  type StatePrivateMessage,
  type StatePublicMessage,
} from '@cartas-na-mesa/protocol';

import { createGameServer } from '../server';
import { SeededFixtureRoom } from './fixture.test-helper';

/**
 * Nome da sala de teste. Diferente do nome de produção de propósito: nenhum
 * cliente real pode alcançar a sala com a seed fixa (doc 0002 §4.1).
 */
export const TEST_ROOM_NAME = 'fixture-test';

/** Tempo máximo de espera por uma mensagem. */
export const WAIT_TIMEOUT_MS = 5_000;

/** Tipos de mensagem do contrato §5 que o servidor envia ao cliente. */
const MESSAGE_TYPES = [
  'join_accepted',
  'room_waiting',
  'state_public',
  'state_private',
  'events',
  'error',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Mensagens recebidas por uma conexão, como chegaram (payload bruto). */
export type RawMessages = Record<MessageType, unknown[]>;

/** As mesmas mensagens, validadas pelos schemas Zod do protocolo. */
export interface ValidatedMessages {
  join_accepted: JoinAcceptedMessage[];
  room_waiting: RoomWaitingMessage[];
  state_public: StatePublicMessage[];
  state_private: StatePrivateMessage[];
  events: EventsMessage[];
  error: ErrorMessage[];
}

/** Valor em `items[index]`, com erro descritivo quando o índice não existe. */
export function at<T>(items: readonly T[], index: number, description: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`${description}: o índice ${index} não existe (há ${items.length} itens).`);
  }
  return value;
}

/**
 * Conecta um cliente real e acumula as mensagens recebidas.
 *
 * Os handlers são registrados assim que o WebSocket abre e **antes** de
 * qualquer mensagem ser enviada ao servidor: assim nenhuma mensagem pode
 * chegar antes do handler que a observa.
 */
export class TestConnection {
  readonly room: Room;

  /** Payload bruto recebido, por tipo de mensagem. */
  readonly messages: RawMessages = {
    join_accepted: [],
    room_waiting: [],
    state_public: [],
    state_private: [],
    events: [],
    error: [],
  };

  private readonly listeners = new Set<() => void>();

  constructor(room: Room) {
    this.room = room;
    for (const type of MESSAGE_TYPES) {
      room.onMessage(type, (payload: unknown) => {
        this.messages[type].push(payload);
        for (const listener of [...this.listeners]) {
          listener();
        }
      });
    }
  }

  /**
   * Espera uma condição sobre o acumulado. A condição é reavaliada a cada
   * mensagem recebida; o timeout impede que o teste fique pendurado.
   */
  async waitFor(
    predicate: () => boolean,
    description: string,
    timeoutMs: number = WAIT_TIMEOUT_MS,
  ): Promise<void> {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (!predicate()) {
          return;
        }
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };

      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`Timeout de ${timeoutMs} ms esperando: ${description}.`));
      }, timeoutMs);

      this.listeners.add(check);
    });
  }
}

/**
 * Espera uma condição **assíncrona** virar verdadeira, reavaliando em
 * intervalos curtos. Usada para condições que não dependem de mensagem
 * recebida pela conexão — por exemplo, o descarte da sala no matchmaking,
 * que acontece depois da saída do cliente.
 *
 * A espera é limitada por tentativas, sem depender do relógio: o resultado
 * do teste não muda com a velocidade da máquina.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs: number = WAIT_TIMEOUT_MS,
): Promise<void> {
  const intervalMs = 20;
  const attempts = Math.ceil(timeoutMs / intervalMs);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout de ${timeoutMs} ms esperando: ${description}.`);
}

/** Conexões abertas nesta execução, para o descarte no fim de cada teste. */
const openConnections = new Set<TestConnection>();

/** Fecha todas as conexões abertas e esvazia o registro. */
export async function closeAllConnections(): Promise<void> {
  const connections = [...openConnections];
  openConnections.clear();
  await Promise.all(connections.map((connection) => connection.room.leave()));
}

/** Sobe o servidor Colyseus real com a sala de seed fixa. */
export async function startTestServer(): Promise<ColyseusTestServer> {
  const server = createGameServer({
    roomTypes: { [TEST_ROOM_NAME]: SeededFixtureRoom },
  });
  return boot(server);
}

/** Cria a sala e informa a identidade do primeiro jogador. */
export async function connectHost(sdk: ColyseusSDK, nickname: string): Promise<TestConnection> {
  const room = await sdk.create(TEST_ROOM_NAME);
  const connection = new TestConnection(room);
  openConnections.add(connection);
  room.send('create_room', { type: 'create_room', nickname, avatarId: null });
  return connection;
}

/** Entra na sala pelo código e informa a identidade do segundo jogador. */
export async function connectGuest(
  sdk: ColyseusSDK,
  roomCode: string,
  nickname: string,
): Promise<TestConnection> {
  const room = await sdk.joinById(roomCode);
  const connection = new TestConnection(room);
  openConnections.add(connection);
  room.send('join_room', { type: 'join_room', roomCode, nickname, avatarId: null });
  return connection;
}

/** Valida todas as mensagens recebidas contra os schemas do protocolo. */
export function validateMessages(messages: RawMessages): ValidatedMessages {
  return {
    join_accepted: parseAll(joinAcceptedMessageSchema, messages.join_accepted, 'join_accepted'),
    room_waiting: parseAll(roomWaitingMessageSchema, messages.room_waiting, 'room_waiting'),
    state_public: parseAll(statePublicMessageSchema, messages.state_public, 'state_public'),
    state_private: parseAll(statePrivateMessageSchema, messages.state_private, 'state_private'),
    events: parseAll(eventsMessageSchema, messages.events, 'events'),
    error: parseAll(errorMessageSchema, messages.error, 'error'),
  };
}

function parseAll<T>(schema: z.ZodType<T>, values: readonly unknown[], type: string): T[] {
  return values.map((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `A mensagem "${type}" no índice ${index} não respeita o contrato do protocolo: ` +
          `${z.prettifyError(parsed.error)} Payload recebido: ${JSON.stringify(value)}`,
      );
    }
    return parsed.data;
  });
}

/** Espera e devolve o `join_accepted` do jogador. */
export async function awaitJoinAccepted(connection: TestConnection): Promise<JoinAcceptedMessage> {
  await connection.waitFor(
    () => connection.messages.join_accepted.length > 0,
    'a mensagem "join_accepted"',
  );
  return at(validateMessages(connection.messages).join_accepted, 0, 'join_accepted');
}

/** Espera e devolve o último `error` recebido. */
export async function awaitError(
  connection: TestConnection,
  description: string = 'a mensagem "error"',
): Promise<ErrorMessage> {
  await connection.waitFor(() => connection.messages.error.length > 0, description);
  const errors = validateMessages(connection.messages).error;
  return at(errors, errors.length - 1, 'error');
}

/** Versões de estado público recebidas até agora, na ordem de chegada. */
export function stateVersions(connection: TestConnection): number[] {
  const versions: number[] = [];
  for (const raw of connection.messages.state_public) {
    const parsed = statePublicMessageSchema.safeParse(raw);
    if (parsed.success) {
      versions.push(parsed.data.version);
    }
  }
  return versions;
}

/** Espera o cliente receber um `state_public` com a versão pedida. */
export async function awaitStateVersion(
  connection: TestConnection,
  version: number,
): Promise<void> {
  await connection.waitFor(
    () => stateVersions(connection).includes(version),
    `o cliente recebe "state_public" com version ${version}`,
  );
}

/** Último `state_public` recebido, validado pelo schema do protocolo. */
export function lastStatePublic(connection: TestConnection): StatePublicMessage {
  const states = validateMessages(connection.messages).state_public;
  return at(states, states.length - 1, 'state_public');
}

/** Último `state_private` recebido, validado pelo schema do protocolo. */
export function lastStatePrivate(connection: TestConnection): StatePrivateMessage {
  const views = validateMessages(connection.messages).state_private;
  return at(views, views.length - 1, 'state_private');
}

/**
 * Todos os valores de string do payload bruto, em qualquer profundidade e
 * incluindo campos fora do contrato.
 */
export function stringValues(payload: unknown): string[] {
  if (typeof payload === 'string') {
    return [payload];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => stringValues(item));
  }
  if (payload !== null && typeof payload === 'object') {
    return Object.values(payload).flatMap((item) => stringValues(item));
  }
  return [];
}

/**
 * Valores do payload bruto que coincidem com os identificadores informados.
 * É a varredura estrutural do critério S3: percorre tudo que a conexão
 * recebeu, incluindo campos fora do contrato.
 */
export function payloadValuesMatching(
  messages: RawMessages,
  candidates: readonly string[],
): string[] {
  const wanted = new Set(candidates);
  return stringValues(messages).filter((value) => wanted.has(value));
}

/**
 * JSON serializado de todas as mensagens recebidas pela conexão: o payload
 * bruto do critério S3, no formato em que trafegou pela rede.
 */
export function rawPayloadJson(messages: RawMessages): string {
  return JSON.stringify(messages);
}

/**
 * Identificadores presentes no JSON bruto como valor completo de string
 * (`"c1"`). A busca é pelo valor inteiro e não por substring: um identificador
 * opaco (UUID de jogador, token de sessão) pode conter os caracteres "c1" por
 * acaso, e esse falso positivo esconderia um vazamento de carta em vez de
 * denunciá-lo.
 */
export function rawJsonMatching(messages: RawMessages, candidates: readonly string[]): string[] {
  const json = rawPayloadJson(messages);
  return candidates.filter((candidate) => json.includes(`"${candidate}"`));
}

/** Par de jogadores com a partida iniciada. */
export interface Match {
  readonly host: TestConnection;
  readonly guest: TestConnection;
  readonly hostAccepted: JoinAcceptedMessage;
  readonly guestAccepted: JoinAcceptedMessage;
  readonly matchId: string;
  readonly roomCode: string;
}

/**
 * Monta a partida do jeito que um jogador faria: o primeiro cria a sala, o
 * segundo entra pelo código, e a partida nasce com o segundo assento.
 */
export async function setupMatch(sdk: ColyseusSDK): Promise<Match> {
  const host = await connectHost(sdk, 'Ana');
  const hostAccepted = await awaitJoinAccepted(host);

  const guest = await connectGuest(sdk, hostAccepted.roomCode, 'Bia');
  const guestAccepted = await awaitJoinAccepted(guest);

  // A partida começa com o segundo assento: ambos recebem a visão inicial.
  await awaitStateVersion(host, 0);
  await awaitStateVersion(guest, 0);

  return {
    host,
    guest,
    hostAccepted,
    guestAccepted,
    matchId: hostAccepted.matchId,
    roomCode: hostAccepted.roomCode,
  };
}
