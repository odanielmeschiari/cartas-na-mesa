import { Room, type Client } from 'colyseus';
import { fixtureGame, createSeededRng, type PlayerSeed } from '@cartas-na-mesa/core';
import {
  actionIntentMessageSchema,
  joinAcceptedMessageSchema,
  roomWaitingMessageSchema,
  statePublicMessageSchema,
  statePrivateMessageSchema,
  eventsMessageSchema,
  errorMessageSchema,
  type SeatInfo,
} from '@cartas-na-mesa/protocol';

interface PlayerSession {
  playerId: string;
  seatIndex: number;
  nickname: string;
  avatarId: string | null;
  sessionToken: string;
}

type FixtureState = ReturnType<typeof fixtureGame.createInitialState>;

export class FixtureRoom extends Room {
  override maxClients = 2;
  override autoDispose = false;

  private roomCode: string;
  private matchId: string;
  private players = new Map<string, PlayerSession>();
  private gameState: FixtureState | null = null;
  private version = 0;

  constructor() {
    super();
    this.roomCode = this.generateRoomCode();
    this.matchId = crypto.randomUUID();

    this.onMessage('action_intent', (client, data) => this.handleAction(client, data));
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private getPlayerSession(sessionId: string): PlayerSession | undefined {
    return this.players.get(sessionId);
  }

  private getSeatInfos(): SeatInfo[] {
    const seats: SeatInfo[] = [];
    for (const [, session] of this.players) {
      seats.push({
        playerId: session.playerId,
        seatIndex: session.seatIndex,
        nickname: session.nickname,
        avatarId: session.avatarId,
        connected: true,
      });
    }
    return seats.sort((a, b) => a.seatIndex - b.seatIndex);
  }

  override onJoin(client: Client, options: Record<string, unknown> = {}) {
    const seatIndex = this.players.size;

    if (seatIndex >= this.maxClients) {
      client.close(1008, 'room_full');
      return;
    }

    const playerId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const nickname =
      typeof options.nickname === 'string'
        ? options.nickname.trim().slice(0, 24)
        : `Jogador ${seatIndex + 1}`;
    const avatarId = typeof options.avatarId === 'string' ? options.avatarId : null;

    this.players.set(client.sessionId, {
      playerId,
      seatIndex,
      nickname,
      avatarId,
      sessionToken,
    });

    client.send(
      'join_accepted',
      joinAcceptedMessageSchema.parse({
        type: 'join_accepted',
        roomCode: this.roomCode,
        matchId: this.matchId,
        playerId,
        seatIndex,
        sessionToken,
      }),
    );

    if (this.players.size === this.maxClients) {
      this.startGame();
    } else {
      client.send(
        'room_waiting',
        roomWaitingMessageSchema.parse({
          type: 'room_waiting',
          roomCode: this.roomCode,
          seats: this.getSeatInfos(),
        }),
      );
    }

    console.log(`[${this.roomId}] jogador entrou: seat=${seatIndex}, playerId=${playerId}`);
  }

  override onLeave(client: Client) {
    const session = this.getPlayerSession(client.sessionId);
    if (session) {
      console.log(
        `[${this.roomId}] jogador saiu: seat=${session.seatIndex}, playerId=${session.playerId}`,
      );
      this.players.delete(client.sessionId);
    }
  }

  private startGame() {
    const players: PlayerSeed[] = [];
    for (const [, session] of this.players) {
      players.push({
        playerId: session.playerId,
        seatIndex: session.seatIndex,
        nickname: session.nickname,
        avatarId: session.avatarId,
      });
    }

    this.gameState = fixtureGame.createInitialState(players, createSeededRng(42));
    this.version = 0;

    this.broadcastState();
  }

  private broadcastState() {
    const gameState = this.gameState;
    if (!gameState) return;

    const publicView = fixtureGame.publicView(gameState);
    const seats = this.getSeatInfos();

    // Estado público idêntico para todos (sem mãos)
    this.broadcast(
      'state_public',
      statePublicMessageSchema.parse({
        type: 'state_public',
        matchId: this.matchId,
        roomCode: this.roomCode,
        version: this.version,
        seats,
        game: publicView,
      }),
    );

    // Visão privada: apenas a mão do próprio cliente
    this.clients.forEach((client) => {
      const session = this.getPlayerSession(client.sessionId);
      if (!session) return;

      const privateView = fixtureGame.viewFor(gameState, session.playerId);

      client.send(
        'state_private',
        statePrivateMessageSchema.parse({
          type: 'state_private',
          matchId: this.matchId,
          version: this.version,
          view: privateView,
        }),
      );
    });
  }

  private handleAction(client: Client, data: unknown) {
    const session = this.getPlayerSession(client.sessionId);
    if (!session) {
      client.send(
        'error',
        errorMessageSchema.parse({
          type: 'error',
          code: 'session_invalid',
          message: 'Sessão inválida.',
        }),
      );
      return;
    }

    // Valida o envelope da intenção de ação com Zod. playerId NÃO vem do cliente.
    const validated = actionIntentMessageSchema.parse(data);

    if (!this.gameState) {
      client.send(
        'error',
        errorMessageSchema.parse({
          type: 'error',
          code: 'game_finished',
          message: 'Partida não iniciada.',
        }),
      );
      return;
    }

    const result = fixtureGame.applyAction(this.gameState, {
      playerId: session.playerId,
      payload: validated.action,
    });

    if (!result.ok) {
      client.send(
        'error',
        errorMessageSchema.parse({
          type: 'error',
          code: result.error.code,
          message: result.error.message,
        }),
      );
      return;
    }

    this.gameState = result.state;
    this.version += 1;

    // Eventos públicos para todos
    this.broadcast(
      'events',
      eventsMessageSchema.parse({
        type: 'events',
        matchId: this.matchId,
        version: this.version,
        events: result.events,
      }),
    );

    // Estado atualizado público + privado
    this.broadcastState();
  }
}
