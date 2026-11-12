import { matchMaker, Room, type Client } from 'colyseus';
import {
  createSeededRng,
  fixtureGame,
  type FixtureEvent,
  type PlayerSeed,
} from '@cartas-na-mesa/core';
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
  type SeatInfo,
} from '@cartas-na-mesa/protocol';

import { randomRoomCode, randomSessionToken, randomUint32 } from './random';

/**
 * Tentativas para conseguir um código de sala livre. Uma colisão faria o
 * Colyseus descartar a sala nova e devolver a sala existente, conectando o
 * cliente à sala alheia (risco b do doc 0002).
 */
const MAX_ROOM_CODE_ATTEMPTS = 5;

/**
 * Texto fixo dos erros da infraestrutura: seguro para exibição, sem eco do
 * payload do cliente e sem detalhe interno. Os erros do motor trazem a própria
 * mensagem, que também é texto de exibição.
 */
const ERROR_MESSAGES = {
  invalid_payload: 'Mensagem inválida.',
  room_not_found: 'Sala não encontrada.',
  room_full: 'A sala está cheia.',
  session_invalid: 'Sessão inválida.',
  match_not_found: 'Partida não encontrada.',
  stale_state: 'O estado da partida mudou. Receba o estado atual e tente de novo.',
  game_finished: 'A partida não está em andamento.',
  internal: 'Erro interno do servidor.',
} as const;

type InfraErrorCode = keyof typeof ERROR_MESSAGES;

/** Sessão de jogo: identidade do jogador, assento e vínculo com a conexão. */
interface PlayerSession {
  playerId: string;
  seatIndex: number;
  nickname: string;
  avatarId: string | null;
  sessionToken: string;
  /** null = desconectado; o assento continua reservado para a reconexão. */
  clientSessionId: string | null;
}

type FixtureState = ReturnType<typeof fixtureGame.createInitialState>;

/**
 * Sala do jogo-fixture do spike.
 *
 * Contrato de rede: docs/architecture/0001-fixture-contract.md §5.
 * Mecanismo de tempo real: docs/architecture/0002-spike-mecanismo-tempo-real.md.
 */
export class FixtureRoom extends Room {
  /**
   * Limite de conexões do Colyseus (inclui reservas pendentes e reconexões).
   * É distinto do número de assentos de jogo: os dois protegem coisas
   * diferentes (risco c do doc 0002).
   */
  override maxClients = 2;

  /**
   * A sala sobrevive a uma queda para permitir a reconexão. Com
   * `autoDispose = true` a sala morreria no primeiro jogador ausente, levando a
   * partida junto; o descarte é explícito (ver `disposeIfFinished`).
   */
  override autoDispose = false;

  private roomCode!: string;
  private matchId!: string;
  private version = 0;
  private gameState: FixtureState | null = null;

  /** Sessão de jogo por `sessionToken`, incluindo jogadores desconectados. */
  private readonly sessionsByToken = new Map<string, PlayerSession>();

  /** Sessão de jogo por `sessionId` da conexão Colyseus. */
  private readonly sessionByClient = new Map<string, PlayerSession>();

  override async onCreate(): Promise<void> {
    this.roomCode = await this.generateRoomCode();

    // O código curto é o roomId do Colyseus: é o identificador que o
    // matchmaking devolve e que o cliente usa para entrar (doc 0002 §1).
    this.roomId = this.roomCode;

    this.matchId = crypto.randomUUID();

    // O setter de metadata só aceita escrita dentro de onCreate; prepara a
    // futura listagem de salas públicas (decisão adiada no doc 0002 §8).
    this.metadata = { roomCode: this.roomCode };

    this.registerMessageHandlers();
  }

  /**
   * `onJoin` não senta ninguém: o assento de jogo é atribuído quando chega a
   * mensagem de identidade (`create_room` / `join_room` / `reconnect`). Na
   * reconexão o `onJoin` roda de novo, com outro `sessionId`; sentar aqui
   * duplicaria o assento.
   */
  override onJoin(): void {
    // intencionalmente vazio
  }

  override async onLeave(client: Client): Promise<void> {
    const session = this.sessionByClient.get(client.sessionId);
    if (session === undefined) {
      return;
    }

    this.sessionByClient.delete(client.sessionId);

    // Só desliga a sessão desta conexão se ela ainda estiver ligada a ela: na
    // reconexão, a saída atrasada da conexão antiga não pode apagar a nova.
    if (session.clientSessionId === client.sessionId) {
      session.clientSessionId = null;
    }

    // O assento de jogo é preservado para a reconexão; `connected` vira false.
    this.publishState();

    await this.disposeIfFinished();
  }

  /**
   * Seed da partida. Produção: CSPRNG. O teste sobrescreve este método.
   *
   * A seed não vem das opções do matchmaking: em produção elas são inteiramente
   * controladas pelo cliente, e a seed precisa ser aleatória e por partida.
   */
  protected createMatchSeed(): number {
    return randomUint32();
  }

  private registerMessageHandlers(): void {
    this.onMessage('create_room', (client: Client, message: unknown) =>
      this.handleCreateRoom(client, message),
    );
    this.onMessage('join_room', (client: Client, message: unknown) =>
      this.handleJoinRoom(client, message),
    );
    this.onMessage('reconnect', (client: Client, message: unknown) =>
      this.handleReconnect(client, message),
    );
    this.onMessage('action_intent', (client: Client, message: unknown) =>
      this.handleActionIntent(client, message),
    );

    // Curinga: tipo desconhecido. O Colyseus chama este handler com
    // (client, type, payload); sem ele, a conexão seria encerrada em produção
    // (risco h do doc 0002). O tipo e o payload não são usados de propósito: a
    // resposta é fixa e não ecoa nada que veio do cliente.
    this.onMessage('*', (client: Client) => {
      this.sendInfraError(client, 'invalid_payload');
    });
  }

  private handleCreateRoom(client: Client, payload: unknown): void {
    const parsed = createRoomMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    if (this.sessionByClient.has(client.sessionId)) {
      // Identidade já informada nesta conexão: sentar de novo criaria um
      // segundo assento para a mesma pessoa.
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    this.seatPlayer(client, parsed.data.nickname, parsed.data.avatarId);
  }

  private handleJoinRoom(client: Client, payload: unknown): void {
    const parsed = joinRoomMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    if (parsed.data.roomCode !== this.roomCode) {
      this.sendInfraError(client, 'room_not_found');
      return;
    }

    if (this.sessionByClient.has(client.sessionId)) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    this.seatPlayer(client, parsed.data.nickname, parsed.data.avatarId);
  }

  private handleReconnect(client: Client, payload: unknown): void {
    const parsed = reconnectMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    if (parsed.data.roomCode !== this.roomCode) {
      this.sendInfraError(client, 'room_not_found');
      return;
    }

    const session = this.sessionsByToken.get(parsed.data.sessionToken);
    if (session === undefined) {
      this.sendInfraError(client, 'session_invalid');
      return;
    }

    // Conflito de vínculo: esta conexão já está presa a **outra** sessão de
    // jogo. Reatribuir aqui faria duas sessões apontarem para a mesma
    // conexão: a visão privada das duas mãos chegaria na mesma conexão
    // (vazamento de carta alheia, contrato §6) e o assento da sessão
    // original ficaria marcado como conectado para sempre, porque a saída
    // da conexão resolveria a sessão pelo vínculo novo. O vínculo existente
    // é preservado e o erro vai só para o remetente.
    const boundSession = this.sessionByClient.get(client.sessionId);
    if (boundSession !== undefined && boundSession !== session) {
      this.sendInfraError(client, 'session_invalid');
      return;
    }

    const previousClientSessionId = session.clientSessionId;
    if (previousClientSessionId !== null && previousClientSessionId !== client.sessionId) {
      // A conexão antiga ainda ocupa a sessão: encerra-a para que a nova
      // assuma o assento. `leave` é o successor de `close`, que está
      // depreciado e emite aviso de depreciação a cada uso.
      this.clients.get(previousClientSessionId)?.leave(4000, 'session_replaced');
    }

    session.clientSessionId = client.sessionId;
    this.sessionByClient.set(client.sessionId, session);

    this.sendJoinAccepted(client, session);
    this.publishState();
  }

  private handleActionIntent(client: Client, payload: unknown): void {
    // Ordem de conferência (doc 0002 §5.2): sessão do emissor, envelope,
    // partida, versão, partida em andamento e, por fim, o motor.
    const session = this.sessionByClient.get(client.sessionId);
    if (session === undefined) {
      this.sendInfraError(client, 'session_invalid');
      return;
    }

    const parsed = actionIntentMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    if (parsed.data.matchId !== this.matchId) {
      this.sendInfraError(client, 'match_not_found');
      return;
    }

    if (parsed.data.stateVersion !== this.version) {
      this.sendInfraError(client, 'stale_state');
      return;
    }

    const gameState = this.gameState;
    if (gameState === null) {
      this.sendInfraError(client, 'game_finished');
      return;
    }

    // O playerId vem da sessão, nunca do cliente.
    const result = fixtureGame.applyAction(gameState, {
      playerId: session.playerId,
      payload: parsed.data.action,
    });

    if (!result.ok) {
      // Erros do motor passam sem tradução; invalid_setup vira internal.
      const code: ErrorCode =
        result.error.code === 'invalid_setup' ? 'internal' : result.error.code;
      this.sendError(client, code, result.error.message);
      return;
    }

    this.gameState = result.state;
    this.version += 1;

    this.publishEvents(result.events);
    this.publishState();
  }

  /**
   * Senta o jogador no primeiro assento livre. Assentos de jogadores
   * desconectados continuam tomados: o assento é preservado para a reconexão.
   */
  private seatPlayer(client: Client, nickname: string, avatarId: string | null): void {
    const seatIndex = this.findFreeSeat();
    if (seatIndex === null) {
      this.sendInfraError(client, 'room_full');
      return;
    }

    const session: PlayerSession = {
      playerId: crypto.randomUUID(),
      seatIndex,
      nickname,
      avatarId,
      sessionToken: randomSessionToken(),
      clientSessionId: client.sessionId,
    };

    // A partida nasce com o segundo assento. Criar o estado antes de registrar
    // a sessão evita deixar o jogador sentado numa sala sem partida quando o
    // setup é recusado pelo motor (defesa em profundidade, contrato §3).
    if (this.gameState === null && this.sessionsByToken.size + 1 === fixtureGame.playerCount.max) {
      try {
        this.startMatch([...this.sessionsByToken.values(), session]);
      } catch (error) {
        console.error(`[${this.roomCode}] falha ao iniciar a partida:`, error);
        this.sendError(client, 'internal', ERROR_MESSAGES.internal);
        return;
      }
    }

    this.sessionsByToken.set(session.sessionToken, session);
    this.sessionByClient.set(client.sessionId, session);

    this.sendJoinAccepted(client, session);
    this.publishState();
  }

  private startMatch(sessions: readonly PlayerSession[]): void {
    const players: PlayerSeed[] = [...sessions]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((session) => ({
        playerId: session.playerId,
        seatIndex: session.seatIndex,
        nickname: session.nickname,
        avatarId: session.avatarId,
      }));

    this.gameState = fixtureGame.createInitialState(
      players,
      createSeededRng(this.createMatchSeed()),
    );
    this.version = 0;
  }

  private findFreeSeat(): number | null {
    const taken = new Set<number>();
    for (const session of this.sessionsByToken.values()) {
      taken.add(session.seatIndex);
    }

    for (let seatIndex = 0; seatIndex < fixtureGame.playerCount.max; seatIndex += 1) {
      if (!taken.has(seatIndex)) {
        return seatIndex;
      }
    }

    return null;
  }

  /** Assentos em ordem de assento, com a presença derivada da sessão. */
  private seatInfos(): SeatInfo[] {
    return [...this.sessionsByToken.values()]
      .sort((left, right) => left.seatIndex - right.seatIndex)
      .map((session) => ({
        playerId: session.playerId,
        seatIndex: session.seatIndex,
        nickname: session.nickname,
        avatarId: session.avatarId,
        connected: session.clientSessionId !== null,
      }));
  }

  /** Jogadores sentados cuja conexão ainda está na sala. */
  private *seatedClients(): Generator<{ session: PlayerSession; client: Client }> {
    for (const session of this.sessionsByToken.values()) {
      if (session.clientSessionId === null) {
        continue;
      }
      const client = this.clients.get(session.clientSessionId);
      if (client === undefined) {
        continue;
      }
      yield { session, client };
    }
  }

  /**
   * Publica presença e estado. O estado público é idêntico para todos; a visão
   * privada vai só para o dono, por conexão. Conexões sem sessão de jogo
   * sentada não recebem nada.
   */
  private publishState(): void {
    const seats = this.seatInfos();

    if (this.gameState === null) {
      const waiting = roomWaitingMessageSchema.parse({
        type: 'room_waiting',
        roomCode: this.roomCode,
        seats,
      });
      for (const { client } of this.seatedClients()) {
        client.send('room_waiting', waiting);
      }
      return;
    }

    const gameState = this.gameState;
    const publicMessage = statePublicMessageSchema.parse({
      type: 'state_public',
      matchId: this.matchId,
      roomCode: this.roomCode,
      version: this.version,
      seats,
      game: fixtureGame.publicView(gameState),
    });

    for (const { session, client } of this.seatedClients()) {
      client.send('state_public', publicMessage);
      client.send(
        'state_private',
        statePrivateMessageSchema.parse({
          type: 'state_private',
          matchId: this.matchId,
          version: this.version,
          view: fixtureGame.viewFor(gameState, session.playerId),
        }),
      );
    }
  }

  private publishEvents(events: readonly FixtureEvent[]): void {
    const message = eventsMessageSchema.parse({
      type: 'events',
      matchId: this.matchId,
      version: this.version,
      events,
    });

    for (const { client } of this.seatedClients()) {
      client.send('events', message);
    }
  }

  private sendJoinAccepted(client: Client, session: PlayerSession): void {
    // O sessionToken sai apenas aqui, para o dono da sessão.
    client.send(
      'join_accepted',
      joinAcceptedMessageSchema.parse({
        type: 'join_accepted',
        roomCode: this.roomCode,
        matchId: this.matchId,
        playerId: session.playerId,
        seatIndex: session.seatIndex,
        sessionToken: session.sessionToken,
      }),
    );
  }

  private sendInfraError(client: Client, code: InfraErrorCode): void {
    this.sendError(client, code, ERROR_MESSAGES[code]);
  }

  private sendError(client: Client, code: ErrorCode, message: string): void {
    client.send(
      'error',
      errorMessageSchema.parse({
        type: 'error',
        code,
        message,
      }),
    );
  }

  /**
   * Gera um código de sala que não colide com outra sala. A colisão faria o
   * Colyseus descartar a sala nova e devolver a sala existente, conectando o
   * cliente à sala alheia (risco b do doc 0002).
   */
  private async generateRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
      const code = randomRoomCode();
      const existing = await matchMaker.getRoomById(code);
      if (!existing) {
        return code;
      }
    }

    throw new Error(
      `Não foi possível gerar um código de sala único após ${MAX_ROOM_CODE_ATTEMPTS} tentativas.`,
    );
  }

  /**
   * Descarte explícito da sala: com `autoDispose = false` ela não morre
   * sozinha, e uma sala vazia ocuparia memória para sempre.
   *
   * São descartados dois casos:
   * - sala vazia **sem partida iniciada**: não há estado de jogo nem assento
   *   de reconexão a preservar;
   * - partida encerrada com todos desconectados.
   *
   * A partida **em andamento** com todos desconectados permanece viva: o
   * prazo da janela de reconexão é uma decisão de produto ainda em aberto
   * (doc 0002 §8, item 1).
   */
  private async disposeIfFinished(): Promise<void> {
    if (this.clients.length > 0) {
      return;
    }

    if (this.gameState === null) {
      await this.disconnect();
      return;
    }

    if (fixtureGame.resultOf(this.gameState) === null) {
      return;
    }

    await this.disconnect();
  }
}
