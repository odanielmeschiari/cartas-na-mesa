import { FixtureRoom } from './fixture';

export const TEST_MATCH_SEED = 42;

/**
 * Prazo curto de identidade, para o teste de expiração da conexão sem
 * identidade. Só existe em teste: a sala de produção usa 30 s.
 */
export const TEST_IDENTITY_TIMEOUT_MS = 400;

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

/**
 * Sala de teste do prazo de identidade: mesma implementação da sala de
 * produção, com seed fixa e prazo de identidade curto.
 *
 * Como a sala de seed fixa, é registrada no servidor de teste com nome
 * próprio, distinto do de produção: nenhum cliente real alcança nenhuma das
 * duas.
 */
export class ShortTimeoutFixtureRoom extends FixtureRoom {
  protected override createMatchSeed(): number {
    return TEST_MATCH_SEED;
  }

  protected override identityTimeoutMs(): number {
    return TEST_IDENTITY_TIMEOUT_MS;
  }
}
