import { createSeededRng, type Rng } from '@cartas-na-mesa/core';

import { HeartsRoom } from './hearts';

export const TEST_HEARTS_SEED = 42;

/** Pausa curta antes de distribuir a próxima mão. Só existe em teste: produção usa 5 s. */
export const TEST_HEARTS_ADVANCE_PAUSE_MS = 50;

/**
 * Sala de teste do Copas: a mesma implementação da sala de produção, com a aleatoriedade
 * determinística. O `Rng` é criado uma vez por sala: a mão seguinte continua a sequência em vez
 * de repetir a primeira distribuição.
 *
 * Como a sala do fixture de teste, é registrada no servidor de teste com nome próprio, distinto do
 * de produção: nenhum cliente real a alcança.
 */
export class SeededHeartsRoom extends HeartsRoom {
  private readonly rng = createSeededRng(TEST_HEARTS_SEED);

  protected override createRng(): Rng {
    return this.rng;
  }

  protected override advancePauseMs(): number {
    return TEST_HEARTS_ADVANCE_PAUSE_MS;
  }
}
