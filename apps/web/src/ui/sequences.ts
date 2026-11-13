import { canPlaceOnTableau, type PatienceState } from '@cartas-na-mesa/core';

export type CompleteRun = {
  readonly column: number;
  /** Índice do Rei na coluna: o K→A ocupa deste índice até o topo. */
  readonly start: number;
  /** Identifica a sequência (coluna + Rei) para não celebrar duas vezes a mesma. */
  readonly key: string;
};

/** Colunas que têm uma sequência completa do K ao A, de cores alternadas, toda virada para cima. */
export function findCompleteRuns(state: PatienceState): readonly CompleteRun[] {
  const runs: CompleteRun[] = [];
  state.tableau.forEach((column, index) => {
    const start = column.length - 13;
    const king = column[start];
    if (king === undefined || king.value !== 'K' || start < (state.faceDown[index] ?? 0)) return;
    const run = column.slice(start);
    const valid = run.every((card, i) => i === 0 || canPlaceOnTableau(card, [run[i - 1] ?? card]));
    if (valid && run[12]?.value === 'A')
      runs.push({ column: index, start, key: `${index}:${king.id}` });
  });
  return runs;
}
