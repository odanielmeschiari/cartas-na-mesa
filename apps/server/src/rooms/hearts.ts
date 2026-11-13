import type {
  HeartsActionPayload,
  HeartsEvent,
  HeartsPrivateView,
  HeartsPublicView,
  HeartsResult,
  HeartsState,
  Rng,
} from '@cartas-na-mesa/core';

import { GameRoom } from './game-room';
import { heartsAdapter } from './game-room-adapter';
import { createCryptoRng } from './random';

/**
 * Sala do Copas: a sala genérica com o adaptador do Copas (doc 0003 §2).
 *
 * Mesa fixa de 4: a partida nasce quando o quarto humano senta. Os bots nos assentos vagos e o
 * início pelo dono entram em passos seguintes (doc 0003 §7, passos 5 e 6).
 */
export class HeartsRoom extends GameRoom<
  HeartsState,
  HeartsActionPayload,
  HeartsPublicView,
  HeartsPrivateView,
  HeartsResult,
  HeartsEvent
> {
  override maxClients = 4;

  protected override readonly adapter = heartsAdapter;

  /** CSPRNG direto, sem seed: a mão oculta nunca depende de um PRNG de 32 bits (pendência A3). */
  protected override createRng(): Rng {
    return createCryptoRng();
  }
}
