import { patienceGame, type PatienceActionPayload, type PatienceState } from '@cartas-na-mesa/core';

const PLAYER_ID = 'player-1';

type Action<T extends PatienceActionPayload['type']> = Extract<PatienceActionPayload, { type: T }>;

export type AutoMoveSource =
  | { readonly kind: 'waste' }
  | { readonly kind: 'tableau'; readonly column: number; readonly cardId: string };

/**
 * Jogada do duplo clique: a posição "certa" da carta, se existir.
 *
 * A fundação tem prioridade; depois vem uma coluna do tabuleiro, preferindo uma
 * coluna com cartas a uma vazia. Só considera jogadas que o núcleo declara legais.
 */
export function findAutoMove(
  state: PatienceState,
  source: AutoMoveSource,
): PatienceActionPayload | null {
  const actions = patienceGame.legalActions(state, PLAYER_ID);
  const targetIsEmpty = (toColumn: number): boolean => (state.tableau[toColumn]?.length ?? 0) === 0;
  const bestColumn = <T extends { readonly toColumn: number }>(options: readonly T[]): T | null =>
    options.find((o) => !targetIsEmpty(o.toColumn)) ?? options[0] ?? null;

  if (source.kind === 'waste') {
    const toFoundation = actions.find((a) => a.type === 'waste_to_foundation');
    if (toFoundation !== undefined) return toFoundation;
    return bestColumn(
      actions.filter((a): a is Action<'waste_to_tableau'> => a.type === 'waste_to_tableau'),
    );
  }

  const toFoundation = actions.find(
    (a) => a.type === 'tableau_to_foundation' && a.fromColumn === source.column,
  );
  const column = state.tableau[source.column] ?? [];
  // Só a carta do topo pode subir para a fundação.
  if (toFoundation !== undefined && column[column.length - 1]?.id === source.cardId) {
    return toFoundation;
  }
  return bestColumn(
    actions.filter(
      (a): a is Action<'tableau_to_tableau'> =>
        a.type === 'tableau_to_tableau' &&
        a.fromColumn === source.column &&
        a.cardId === source.cardId,
    ),
  );
}
