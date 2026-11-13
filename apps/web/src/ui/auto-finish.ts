import { patienceGame, type PatienceActionPayload, type PatienceState } from '@cartas-na-mesa/core';

const PLAYER_ID = 'player-1';
/** Teto de segurança: um monte de 24 cartas recicla no máximo ~25 vezes por carta de fundação. */
const MAX_STEPS = 5000;

/**
 * O jogo pode ser finalizado quando as 7 colunas estão com todas as cartas viradas.
 *
 * Nesse ponto cada coluna é uma sequência decrescente de cores alternadas, então a
 * menor carta ainda fora da fundação está sempre no topo de uma coluna ou no
 * monte/descarte: levar cartas para a fundação e virar o monte sempre vence.
 */
export function canAutoFinish(state: PatienceState): boolean {
  return state.status === 'playing' && state.faceDown.every((n) => n === 0);
}

function nextFoundationMove(state: PatienceState): PatienceActionPayload | null {
  const actions = patienceGame.legalActions(state, PLAYER_ID);
  return (
    actions.find((a) => a.type === 'tableau_to_foundation') ??
    actions.find((a) => a.type === 'waste_to_foundation') ??
    null
  );
}

export type AutoFinishPlan = {
  /** Estado depois de cada carta que sobe para a fundação (virar o monte fica embutido). */
  readonly steps: readonly PatienceState[];
  /** `false` se o plano não chegou à vitória (não deve acontecer quando `canAutoFinish`). */
  readonly completed: boolean;
};

/** Calcula, pelo próprio motor de regras, a sequência de estados que leva à vitória. */
export function planAutoFinish(start: PatienceState): AutoFinishPlan {
  const steps: PatienceState[] = [];
  let current = start;
  for (let i = 0; i < MAX_STEPS && current.status === 'playing'; i += 1) {
    const payload = nextFoundationMove(current) ?? ({ type: 'flip_stock' } as const);
    const result = patienceGame.applyAction(current, { playerId: PLAYER_ID, payload });
    if (!result.ok) break;
    current = result.state;
    if (payload.type !== 'flip_stock') steps.push(current);
  }
  return { steps, completed: current.status === 'finished' };
}
