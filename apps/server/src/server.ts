import { createServer } from 'node:http';
import { Server, WebSocketTransport, type Room } from 'colyseus';

import { FixtureRoom } from './rooms/fixture';
import { HeartsRoom } from './rooms/hearts';

/** Classe de sala registrada no matchmaking. */
export type RoomClass = new () => Room;

export interface GameServerOptions {
  /** Tipos de sala registrados, por nome. Padrão: { fixture: FixtureRoom, hearts: HeartsRoom }. */
  roomTypes?: Record<string, RoomClass>;
}

/**
 * Cria o servidor Colyseus com o transporte WebSocket e os tipos de sala.
 *
 * A fábrica não faz `listen`: quem decide a porta é quem chama, de modo que
 * produção e teste usem exatamente o mesmo caminho de código.
 */
export function createGameServer(options: GameServerOptions = {}): Server {
  const httpServer = createServer();
  const transport = new WebSocketTransport({ server: httpServer });
  const server = new Server({ transport });

  const roomTypes = options.roomTypes ?? { fixture: FixtureRoom, hearts: HeartsRoom };
  for (const [name, roomClass] of Object.entries(roomTypes)) {
    server.define(name, roomClass);
  }

  return server;
}
