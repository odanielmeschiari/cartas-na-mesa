import { FixtureRoom } from './fixture';

export const TEST_MATCH_SEED = 42;

/**
 * Sala de teste: mesma implementação da sala de produção, com seed fixa.
 * Estende a sala de produção de propósito — o caminho exercitado nos testes é
 * o mesmo de produção, com uma única substituição.
 */
export class SeededFixtureRoom extends FixtureRoom {
  protected override createMatchSeed(): number {
    return TEST_MATCH_SEED;
  }
}
