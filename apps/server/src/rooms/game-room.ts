import { matchMaker, Room, type Client } from 'colyseus';
import type { PlayerSeed, Rng } from '@cartas-na-mesa/core';
import {
  actionIntentEnvelopeSchema,
  createRoomMessageSchema,
  errorMessageSchema,
  joinAcceptedMessageSchema,
  joinRoomMessageSchema,
  reconnectMessageSchema,
  roomWaitingMessageSchema,
  type ErrorCode,
  type SeatInfo,
} from '@cartas-na-mesa/protocol';

import type { GameRoomAdapter } from './game-room-adapter';
import { randomRoomCode, randomSessionToken } from './random';

/**
 * Tentativas para conseguir um código de sala livre. Uma colisão faria o
 * Colyseus descartar a sala nova e devolver a sala existente, conectando o
 * cliente à sala alheia (risco b do doc 0002).
 */
const MAX_ROOM_CODE_ATTEMPTS = 5;

/**
 * Prazo que uma conexão pode ficar sem se identificar antes de ser encerrada.
 *
 * `maxClients` do Colyseus limita **conexões**, não assentos de jogo: uma
 * conexão que nunca se identifica ocupa uma das vagas e barra o jogador
 * legítimo no matchmaking (risco c do doc 0002). O prazo é generoso o bastante
 * para uma rede lenta e curto o bastante para não segurar a sala
 * indefinidamente.
 */
const IDENTITY_TIMEOUT_MS = 30_000;

/** Timeout agendado no relógio da sala; cancelado por `clear()`. */
type ScheduledTimeout = ReturnType<Room['clock']['setTimeout']>;

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

/**
 * Sala genérica: não conhece regra de jogo (regra 12 do AGENTS.md). Tudo o que é de um jogo
 * entra pelo adaptador (doc 0003 §2); cada jogo é uma subclasse fina que escolhe o adaptador e a
 * fonte de aleatoriedade.
 *
 * Contrato de rede: docs/architecture/0001-fixture-contract.md §5 e ADR-002.
 * Mecanismo de tempo real: docs/architecture/0002-spike-mecanismo-tempo-real.md.
 *
 * Cada subclasse também define `maxClients`, o limite de conexões do Colyseus (inclui reservas
 * pendentes e reconexões). Ele é distinto do número de assentos de jogo: os dois protegem coisas
 * diferentes (risco c do doc 0002).
 */
export abstract class GameRoom<S, A, P, V, R, E> extends Room {
  /** Adaptador do jogo. Só é lido depois da construção (em `onCreate` e nos handlers). */
  protected abstract readonly adapter: GameRoomAdapter<S, A, P, V, R, E>;

  /**
   * `Rng` da partida. Cada jogo escolhe a fonte: o fixture usa uma seed por partida (e o teste a
   * sobrescreve); jogos com mão oculta usam o CSPRNG direto (`createCryptoRng`, pendência A3).
   */
  protected abstract createRng(): Rng;

  /**
   * A sala sobrevive a uma queda para permitir a reconexão. Com
   * `autoDispose = true` a sala morreria no primeiro jogador ausente, levando a
   * partida junto; o descarte é explícito (ver `disposeIfFinished`).
   */
  override autoDispose = false;

  private roomCode!: string;
  private matchId!: string;
  private version = 0;
  private gameState: S | null = null;

  /** Sessão de jogo por `sessionToken`, incluindo jogadores desconectados. */
  private readonly sessionsByToken = new Map<string, PlayerSession>();

  /** Sessão de jogo por `sessionId` da conexão Colyseus. */
  private readonly sessionByClient = new Map<string, PlayerSession>();

  /** Prazo de identidade pendente, por `sessionId` da conexão Colyseus. */
  private readonly identityTimeouts = new Map<string, ScheduledTimeout>();

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
   *
   * O que o `onJoin` faz é armar o prazo de identidade: uma conexão que nunca
   * se identifica não pode segurar uma das vagas de conexão do Colyseus.
   */
  override onJoin(client: Client): void {
    const delayed = this.clock.setTimeout(() => {
      this.identityTimeouts.delete(client.sessionId);

      // Identificar-se cancela o prazo antes; se a conexão ainda estiver sem
      // identidade, ela seguraria uma vaga de conexão indefinidamente.
      if (!this.sessionByClient.has(client.sessionId)) {
        client.leave(4000, 'identity_timeout');
      }
    }, this.identityTimeoutMs());

    this.identityTimeouts.set(client.sessionId, delayed);
  }

  /**
   * Prazo de identidade em milissegundos. É a costura de teste: a sala de
   * teste sobrescreve este método para encurtar o prazo (doc 0002 §4).
   */
  protected identityTimeoutMs(): number {
    return IDENTITY_TIMEOUT_MS;
  }

  override async onLeave(client: Client): Promise<void> {
    this.unbindSession(client);
    this.cancelIdentityTimeout(client);
    this.publishState();
    await this.disposeIfFinished();
  }

  /**
   * Desvincula a sessão de jogo da conexão que saiu. O assento é preservado
   * (a reconexão é possível); o que muda é a presença, que vira
   * `connected: false`.
   */
  private unbindSession(client: Client): void {
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
  }

  /**
   * Cancela o prazo de identidade da conexão, se ainda estiver pendente. A
   * entrada do mapa é removida junto: um prazo já disparado não pode ficar
   * pendurado na sala.
   */
  private cancelIdentityTimeout(client: Client): void {
    const delayed = this.identityTimeouts.get(client.sessionId);
    if (delayed === undefined) {
      return;
    }

    this.identityTimeouts.delete(client.sessionId);
    delayed.clear();
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
      // A conexão antiga perde a autorização **imediatamente**. O `leave` é
      // assíncrono: enquanto ele não conclui, a conexão antiga ainda
      // constaria em `sessionByClient` e poderia enviar `action_intent` — uma
      // jogada duplicada ou fora de ordem. Por isso o desvinculo vem antes do
      // `leave`.
      //
      // A guarda "uma sessão por conexão" continua válida: ela compara
      // `sessionByClient.get(client.sessionId)` — a conexão **nova** — com a
      // sessão do token, e o desvinculo remove a entrada da conexão
      // **antiga**, que é outra.
      this.sessionByClient.delete(previousClientSessionId);

      // A conexão antiga ainda ocupa a sala: encerra-a para que a nova
      // assuma o assento. `leave` é o successor de `close`, que está
      // depreciado e emite aviso de depreciação a cada uso.
      this.clients.get(previousClientSessionId)?.leave(4000, 'session_replaced');
    }

    session.clientSessionId = client.sessionId;
    this.sessionByClient.set(client.sessionId, session);

    // Identidade confirmada: o prazo de identidade não deve encerrar a
    // conexão.
    this.cancelIdentityTimeout(client);

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

    // Envelope genérico e, em seguida, a ação revalidada com o schema do próprio jogo (ADR-002,
    // item 2): uma ação de outro jogo falha aqui com `invalid_payload`.
    const parsed = actionIntentEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      this.sendInfraError(client, 'invalid_payload');
      return;
    }

    const action = this.adapter.actionSchema.safeParse(parsed.data.action);
    if (!action.success) {
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
    const result = this.adapter.game.applyAction(gameState, {
      playerId: session.playerId,
      payload: action.data,
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
    if (this.gameState === null && this.sessionsByToken.size + 1 === this.adapter.game.playerCount.max) {
      try {
        this.startMatch([...this.sessionsByToken.values(), session]);
      } catch (error) {
        // O log não pode expor o `roomCode`: ele é o `roomId` do Colyseus e,
        // portanto, a credencial de acesso à sala. O `matchId` identifica a
        // partida sem revelar a credencial, e a mensagem do erro dispensa a
        // pilha (caminhos do servidor).
        console.error(
          `[${this.matchId}] falha ao iniciar a partida:`,
          error instanceof Error ? error.message : String(error),
        );
        this.sendError(client, 'internal', ERROR_MESSAGES.internal);
        return;
      }
    }

    this.sessionsByToken.set(session.sessionToken, session);
    this.sessionByClient.set(client.sessionId, session);

    // Identidade confirmada: o prazo de identidade não deve encerrar a
    // conexão.
    this.cancelIdentityTimeout(client);

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

    this.gameState = this.adapter.game.createInitialState(players, this.createRng());
    this.version = 0;
  }

  private findFreeSeat(): number | null {
    const taken = new Set<number>();
    for (const session of this.sessionsByToken.values()) {
      taken.add(session.seatIndex);
    }

    for (let seatIndex = 0; seatIndex < this.adapter.game.playerCount.max; seatIndex += 1) {
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
        kind: 'human',
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
    const publicMessage = this.adapter.messages.statePublic.parse({
      type: 'state_public',
      matchId: this.matchId,
      roomCode: this.roomCode,
      version: this.version,
      seats,
      game: this.adapter.game.publicView(gameState),
    });

    for (const { session, client } of this.seatedClients()) {
      client.send('state_public', publicMessage);
      client.send(
        'state_private',
        this.adapter.messages.statePrivate.parse({
          type: 'state_private',
          matchId: this.matchId,
          version: this.version,
          view: this.adapter.game.viewFor(gameState, session.playerId),
        }),
      );
    }
  }

  private publishEvents(events: readonly E[]): void {
    const message = this.adapter.messages.events.parse({
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

    if (this.adapter.game.resultOf(this.gameState) === null) {
      return;
    }

    await this.disconnect();
  }
}
