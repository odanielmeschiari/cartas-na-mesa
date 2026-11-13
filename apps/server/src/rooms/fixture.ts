import {
  createSeededRng,
  type FixtureActionPayload,
  type FixtureEvent,
  type FixturePrivateView,
  type FixturePublicView,
  type MatchResult,
  type Rng,
} from '@cartas-na-mesa/core';

import { GameRoom } from './game-room';
import { fixtureAdapter, type FixtureState } from './game-room-adapter';
import { randomUint32 } from './random';

/**
 * Sala do jogo-fixture do spike: a sala genérica com o adaptador do fixture.
 *
 * Contrato de rede: docs/architecture/0001-fixture-contract.md §5.
 */
export class FixtureRoom extends GameRoom<
  FixtureState,
  FixtureActionPayload,
  FixturePublicView,
  FixturePrivateView,
  MatchResult,
  FixtureEvent
> {
  override maxClients = 2;

  protected override readonly adapter = fixtureAdapter;

  protected override createRng(): Rng {
    return createSeededRng(this.createMatchSeed());
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
}
