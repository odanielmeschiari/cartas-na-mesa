import { Client, type Room } from '@colyseus/sdk';
import {
  actionIntentMessageSchema,
  createRoomMessageSchema,
  errorMessageSchema,
  eventsMessageSchema,
  joinAcceptedMessageSchema,
  joinRoomMessageSchema,
  reconnectMessageSchema,
  roomWaitingMessageSchema,
  statePrivateMessageSchema,
  statePublicMessageSchema,
  type ErrorCode,
  type FixturePrivateView,
  type FixturePublicView,
  type GameEvent,
  type SeatInfo,
} from '@cartas-na-mesa/protocol';

import { translateMatchmakingError } from './matchmaking';

/**
 * Cliente do spike: conecta no servidor pelo SDK oficial do Colyseus e
 * mantém um **snapshot** do estado recebido.
 *
 * O cliente não implementa regra de jogo (regra 9): ele só traduz o que o
 * servidor disse. Toda mensagem recebida é validada com o schema Zod do
 * contrato antes de entrar no snapshot — o cliente não confia no payload do
 * servidor para decidir o que mostrar (defesa em profundidade).
 *
 * Contrato de rede: `docs/architecture/0001-fixture-contract.md` §5.
 * Mecanismo: `docs/architecture/0002-spike-mecanismo-tempo-real.md`.
 */

/** Nome da sala do spike: o jogo-fixture, descartável (contrato §4). */
const ROOM_NAME = 'fixture';

/** Quantidade de eventos mantidos no snapshot (os mais recentes). */
const MAX_EVENTS = 20;

/**
 * Textos fixos do cliente, para os erros que ele próprio detecta. Nenhum
 * deles ecoa o payload recebido: a mensagem da UI é sempre texto seguro.
 */
const CLIENT_MESSAGES = {
  invalidPayload: 'Mensagem inválida.',
  notPlaying: 'A partida ainda não começou.',
  transport: 'A conexão com o servidor foi interrompida.',
} as const;

/**
 * Estado do ciclo de vida da conexão.
 *
 * - `connecting`: conectado ao WebSocket, aguardando o primeiro estado.
 * - `waiting`: a sala existe, mas a partida ainda não começou.
 * - `playing`: a partida começou (`state_public` recebido).
 * - `reconnecting`: a conexão caiu sem ter sido pedida; cabe reconectar.
 * - `error`: a conexão foi encerrada por falha de transporte.
 *
 * **Decisão:** `status` descreve o ciclo de vida da conexão, e **não** muda
 * por causa de `lastError`. Um erro de ação (por exemplo `not_your_turn`) não
 * altera o estado da mesa: ele fica em `lastError`, e o estado continua em
 * `playing`.
 */
export type SpikeClientStatus = 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'error';

/** Retrato do estado conhecido pelo cliente. */
export interface SpikeClientSnapshot {
  status: SpikeClientStatus;
  roomCode: string | null;
  matchId: string | null;
  version: number;
  seats: readonly SeatInfo[];
  publicGame: FixturePublicView | null;
  privateView: FixturePrivateView | null;
  events: readonly GameEvent[];
  lastError: { code: ErrorCode; message: string } | null;
}

/** Opções comuns a todas as fábricas. */
export interface SpikeClientServerOptions {
  /** URL do servidor Colyseus, por exemplo `ws://localhost:3001`. */
  serverUrl: string;
}

/** Opções de criação de sala: identidade do jogador. */
export interface SpikeClientIdentityOptions extends SpikeClientServerOptions {
  nickname: string;
  avatarId: string | null;
}

/** Opções de entrada por código de sala. */
export interface SpikeClientJoinOptions extends SpikeClientIdentityOptions {
  roomCode: string;
}

/** Opções de reconexão: a sessão de jogo é reaproveitada pelo token. */
export interface SpikeClientReconnectOptions extends SpikeClientServerOptions {
  roomCode: string;
  sessionToken: string;
}

/**
 * Erro do cliente com o `code` do protocolo já traduzido.
 *
 * Existe para que a UI trate **uma única tabela de códigos**, venha ela de
 * uma falha de matchmaking ou de qualquer outra origem.
 */
export class SpikeClientError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'SpikeClientError';
    this.code = code;
  }
}

/** Snapshot inicial, sem nada conhecido do servidor. */
function createInitialSnapshot(): SpikeClientSnapshot {
  return {
    status: 'connecting',
    roomCode: null,
    matchId: null,
    version: 0,
    seats: [],
    publicGame: null,
    privateView: null,
    events: [],
    lastError: null,
  };
}

export class SpikeClient {
  private readonly room: Room;
  private readonly listeners = new Set<(snapshot: SpikeClientSnapshot) => void>();

  private state: SpikeClientSnapshot = createInitialSnapshot();

  /**
   * Token da sessão de jogo. **Nunca** entra no snapshot: ele é privado do
   * dono e sai da sala para o chamador guardar no storage local.
   */
  private token: string | null = null;

  /** true depois do primeiro `state_public`: a versão conhecida é a atual. */
  private hasPublicState = false;

  /** true quando a saída foi pedida por este cliente. */
  private leavingByRequest = false;

  private constructor(room: Room) {
    this.room = room;
    this.registerHandlers();
  }

  /**
   * Cria a sala e senta o jogador.
   *
   * O matchmaking (`sdk.create`) acontece **antes** do WebSocket: a identidade
   * vai por mensagem, depois que a conexão abre (doc 0002 §1.1).
   */
  static async create(options: SpikeClientIdentityOptions): Promise<SpikeClient> {
    const message = createRoomMessageSchema.safeParse({
      type: 'create_room',
      nickname: options.nickname,
      avatarId: options.avatarId,
    });
    if (!message.success) {
      throw new SpikeClientError('invalid_payload', CLIENT_MESSAGES.invalidPayload);
    }

    const sdk = new Client(options.serverUrl);
    const room = await SpikeClient.openRoom(() => sdk.create(ROOM_NAME));
    const client = new SpikeClient(room);
    room.send('create_room', message.data);

    return client;
  }

  /** Entra na sala pelo código e senta o jogador. */
  static async join(options: SpikeClientJoinOptions): Promise<SpikeClient> {
    const message = joinRoomMessageSchema.safeParse({
      type: 'join_room',
      roomCode: options.roomCode,
      nickname: options.nickname,
      avatarId: options.avatarId,
    });
    if (!message.success) {
      throw new SpikeClientError('invalid_payload', CLIENT_MESSAGES.invalidPayload);
    }

    const sdk = new Client(options.serverUrl);
    const room = await SpikeClient.openRoom(() => sdk.joinById(message.data.roomCode));
    const client = new SpikeClient(room);
    room.send('join_room', message.data);

    return client;
  }

  /**
   * Reentra na sala com o token da sessão de jogo.
   *
   * A reconexão do projeto é por **mensagem** (`reconnect` com
   * `sessionToken`), e não o mecanismo nativo do Colyseus, que exige outro
   * formato de token (doc 0002 §1.3).
   */
  static async reconnect(options: SpikeClientReconnectOptions): Promise<SpikeClient> {
    const message = reconnectMessageSchema.safeParse({
      type: 'reconnect',
      roomCode: options.roomCode,
      sessionToken: options.sessionToken,
    });
    if (!message.success) {
      throw new SpikeClientError('invalid_payload', CLIENT_MESSAGES.invalidPayload);
    }

    const sdk = new Client(options.serverUrl);
    const room = await SpikeClient.openRoom(() => sdk.joinById(message.data.roomCode));
    const client = new SpikeClient(room);
    room.send('reconnect', message.data);

    return client;
  }

  /** Estado atual conhecido pelo cliente. */
  get snapshot(): SpikeClientSnapshot {
    return this.state;
  }

  /**
   * Token da sessão de jogo, para o chamador guardar no storage local.
   * Fica fora do snapshot de propósito: o snapshot é o estado compartilhável
   * com a UI, e o token é credencial.
   */
  sessionToken(): string | null {
    return this.token;
  }

  /**
   * Assina as mudanças de estado. Devolve a função de cancelamento.
   *
   * A assinatura é só sobre as **mudanças**: quem assina deve ler o
   * `snapshot` depois de assinar, para não perder o estado atual.
   */
  subscribe(listener: (snapshot: SpikeClientSnapshot) => void): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Envia a intenção de jogar uma carta.
   *
   * O cliente envia a **intenção**; a legalidade é conferida pelo servidor,
   * que é a única fonte de verdade (regra 9). O `matchId` e a `stateVersion`
   * são os do snapshot atual.
   */
  playCard(cardId: string): void {
    const { matchId, version } = this.state;

    if (matchId === null || !this.hasPublicState) {
      // Sem partida e sem versão conhecida não há intenção a enviar: o erro
      // fica no snapshot, sem derrubar a aplicação.
      this.setError({ code: 'internal', message: CLIENT_MESSAGES.notPlaying });
      return;
    }

    const message = actionIntentMessageSchema.safeParse({
      type: 'action_intent',
      matchId,
      stateVersion: version,
      action: { type: 'play_card', cardId },
    });
    if (!message.success) {
      this.setError({ code: 'invalid_payload', message: CLIENT_MESSAGES.invalidPayload });
      return;
    }

    this.room.send('action_intent', message.data);
  }

  /** Sai da sala. */
  leave(): void {
    this.leavingByRequest = true;
    void this.room.leave();
  }

  /**
   * Conecta e traduz a falha do matchmaking.
   *
   * A falha do matchmaking acontece **antes** do WebSocket e não é uma
   * mensagem `error` do protocolo: ela chega como `MatchMakeError` e é
   * traduzida para o mesmo conjunto de `code` (doc 0002 §5.1).
   */
  private static async openRoom(open: () => Promise<Room>): Promise<Room> {
    try {
      return await open();
    } catch (error) {
      const translated = translateMatchmakingError(error);
      throw new SpikeClientError(translated.code, translated.message);
    }
  }

  /**
   * Registra os handlers das mensagens do servidor.
   *
   * Os handlers são registrados **antes** de a identidade ser enviada, para
   * que nenhuma resposta do servidor se perca.
   */
  private registerHandlers(): void {
    this.room.onMessage('join_accepted', (payload: unknown) => {
      const parsed = joinAcceptedMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      this.token = parsed.data.sessionToken;
      this.update({
        roomCode: parsed.data.roomCode,
        matchId: parsed.data.matchId,
      });
    });

    this.room.onMessage('room_waiting', (payload: unknown) => {
      const parsed = roomWaitingMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      this.update({
        status: 'waiting',
        roomCode: parsed.data.roomCode,
        seats: parsed.data.seats,
      });
    });

    this.room.onMessage('state_public', (payload: unknown) => {
      const parsed = statePublicMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      this.hasPublicState = true;
      this.update({
        status: 'playing',
        matchId: parsed.data.matchId,
        roomCode: parsed.data.roomCode,
        version: parsed.data.version,
        seats: parsed.data.seats,
        publicGame: parsed.data.game,
      });
    });

    this.room.onMessage('state_private', (payload: unknown) => {
      const parsed = statePrivateMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      this.update({
        matchId: parsed.data.matchId,
        version: parsed.data.version,
        privateView: parsed.data.view,
      });
    });

    this.room.onMessage('events', (payload: unknown) => {
      const parsed = eventsMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      this.update({
        matchId: parsed.data.matchId,
        version: parsed.data.version,
        events: [...this.state.events, ...parsed.data.events].slice(-MAX_EVENTS),
      });
    });

    this.room.onMessage('error', (payload: unknown) => {
      const parsed = errorMessageSchema.safeParse(payload);
      if (!parsed.success) {
        this.reportInvalidPayload();
        return;
      }

      // Erro do servidor: entra no `lastError` e **não** derruba a conexão.
      this.setError({ code: parsed.data.code, message: parsed.data.message });
    });

    this.room.onError(() => {
      this.setError({ code: 'internal', message: CLIENT_MESSAGES.transport });
      this.update({ status: 'error' });
    });

    this.room.onLeave(() => {
      if (this.leavingByRequest) {
        return;
      }

      // A conexão caiu sem ter sido pedida: cabe reconectar com o token.
      this.update({ status: 'reconnecting' });
    });
  }

  /** Mensagem fora do contrato: é descartada e vira erro no cliente. */
  private reportInvalidPayload(): void {
    this.setError({ code: 'invalid_payload', message: CLIENT_MESSAGES.invalidPayload });
  }

  private setError(error: { code: ErrorCode; message: string }): void {
    this.update({ lastError: error });
  }

  private update(patch: Partial<SpikeClientSnapshot>): void {
    this.state = { ...this.state, ...patch };

    for (const listener of [...this.listeners]) {
      listener(this.state);
    }
  }
}
