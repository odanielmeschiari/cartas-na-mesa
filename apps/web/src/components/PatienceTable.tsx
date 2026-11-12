import { useCallback, useEffect, useState } from 'react';

import {
  createSeededRng,
  patienceGame,
  PATIENCE_SUITS,
  type PatienceActionPayload,
  type PatienceCard,
  type PatienceState,
  type PatienceSuit,
} from '@cartas-na-mesa/core';

import { cardBackUrl, cardFaceUrl, cardName, SUIT_SYMBOL } from '../ui/card-assets';

const PLAYER_ID = 'player-1';
const PLAYERS = [{ playerId: PLAYER_ID, seatIndex: 0, nickname: 'Você', avatarId: null }] as const;

type Selection =
  | { kind: 'waste' }
  | { kind: 'tableau'; column: number; cardId: string }
  | { kind: 'foundation'; suit: PatienceSuit };

function newGame(): PatienceState {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  return patienceGame.createInitialState(PLAYERS, createSeededRng(seed));
}

/** Altura (em larguras de carta) de uma coluna com as cartas empilhadas. */
function columnHeight(total: number, down: number): number {
  const downCount = Math.min(down, total);
  return 1.35 + downCount * 0.14 + Math.max(total - downCount - 1, 0) * 0.32 + (total === 0 ? 0 : 0);
}

function CardFace({ card, selected }: { card: PatienceCard; selected?: boolean }) {
  const url = cardFaceUrl(card);
  return (
    <span
      aria-hidden="true"
      className={`cnm-card ${selected ? 'cnm-card-selected' : ''}`}
      style={url === undefined ? undefined : { backgroundImage: `url("${url}")` }}
    >
      {url === undefined ? `${card.value}${SUIT_SYMBOL[card.suit]}` : null}
    </span>
  );
}

function CardBack() {
  const url = cardBackUrl();
  return (
    <span
      aria-hidden="true"
      className="cnm-card cnm-card-back"
      style={url === undefined ? undefined : { backgroundImage: `url("${url}")` }}
    />
  );
}

/**
 * Mesa de Paciência (Klondike, compra de 1 carta) — modo solo.
 *
 * Toda regra vive em `patienceGame` (núcleo determinístico); aqui só se
 * escolhe a origem e o destino. Toque/clique em uma carta para selecioná-la e
 * depois no destino; duplo clique envia a carta direto para a fundação.
 */
export default function PatienceTable() {
  const [state, setState] = useState<PatienceState>(() => newGame());
  const [history, setHistory] = useState<readonly PatienceState[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => setMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const run = useCallback(
    (payload: PatienceActionPayload): boolean => {
      const result = patienceGame.applyAction(state, { playerId: PLAYER_ID, payload });
      if (!result.ok) {
        setMessage(result.error.message);
        return false;
      }
      setHistory((h) => [...h, state]);
      setState(result.state);
      setSelection(null);
      return true;
    },
    [state],
  );

  const restart = () => {
    setState(newGame());
    setHistory([]);
    setSelection(null);
    setMessage(null);
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (previous === undefined) return;
    setState(previous);
    setHistory(history.slice(0, -1));
    setSelection(null);
  };

  const sendSelectionToFoundation = (sel: Selection): boolean =>
    sel.kind === 'waste'
      ? run({ type: 'waste_to_foundation' })
      : sel.kind === 'tableau'
        ? run({ type: 'tableau_to_foundation', fromColumn: sel.column })
        : false;

  const onTableauClick = (column: number, card: PatienceCard | null) => {
    if (selection === null) {
      if (card !== null) setSelection({ kind: 'tableau', column, cardId: card.id });
      return;
    }
    if (selection.kind === 'tableau' && selection.column === column) {
      setSelection(card === null || selection.cardId === card.id ? null : { kind: 'tableau', column, cardId: card.id });
      return;
    }
    const moved =
      selection.kind === 'waste'
        ? run({ type: 'waste_to_tableau', toColumn: column })
        : selection.kind === 'tableau'
          ? run({ type: 'tableau_to_tableau', fromColumn: selection.column, toColumn: column, cardId: selection.cardId })
          : run({ type: 'foundation_to_tableau', suit: selection.suit, toColumn: column });
    if (!moved && card !== null) setSelection({ kind: 'tableau', column, cardId: card.id });
  };

  const onFoundationClick = (suit: PatienceSuit) => {
    const pile = state.foundations[PATIENCE_SUITS.indexOf(suit)] ?? [];
    if (selection === null) {
      if (pile.length > 0) setSelection({ kind: 'foundation', suit });
      return;
    }
    if (!sendSelectionToFoundation(selection) && selection.kind === 'foundation') setSelection(null);
  };

  const wasteTop = state.waste[state.waste.length - 1];
  const inFoundations = state.foundations.reduce((sum, pile) => sum + pile.length, 0);
  const won = state.status === 'finished';

  return (
    <section aria-label="Mesa de Paciência" className="cnm-felt">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <p className="text-sm font-semibold text-emerald-50" role="status">
          Movimentos: {state.moves} · Fundações: {inFoundations}/52
        </p>
        <div className="flex gap-2">
          <button className="cnm-btn" disabled={history.length === 0} onClick={undo} type="button">
            Desfazer
          </button>
          <button className="cnm-btn" onClick={restart} type="button">
            Nova partida
          </button>
        </div>
      </div>

      <div className="cnm-board">
        <div className="cnm-row">
          <button
            aria-label={state.stock.length > 0 ? `Virar carta do monte (${state.stock.length} restantes)` : 'Reciclar o descarte no monte'}
            className="cnm-slot"
            onClick={() => run({ type: 'flip_stock' })}
            type="button"
          >
            {state.stock.length > 0 ? <CardBack /> : <span className="cnm-slot-hint">↻</span>}
          </button>

          <button
            aria-label={wasteTop === undefined ? 'Descarte vazio' : `Descarte: ${cardName(wasteTop)}`}
            className="cnm-slot"
            disabled={wasteTop === undefined}
            onClick={() => setSelection(selection?.kind === 'waste' ? null : { kind: 'waste' })}
            onDoubleClick={() => sendSelectionToFoundation({ kind: 'waste' })}
            type="button"
          >
            {wasteTop === undefined ? null : <CardFace card={wasteTop} selected={selection?.kind === 'waste'} />}
          </button>

          <span className="cnm-spacer" />

          {PATIENCE_SUITS.map((suit, i) => {
            const pile = state.foundations[i] ?? [];
            const top = pile[pile.length - 1];
            return (
              <button
                aria-label={`Fundação de ${suit}: ${pile.length} carta(s)`}
                className="cnm-slot"
                key={suit}
                onClick={() => onFoundationClick(suit)}
                type="button"
              >
                {top === undefined ? (
                  <span className="cnm-slot-hint">{SUIT_SYMBOL[suit]}</span>
                ) : (
                  <CardFace card={top} selected={selection?.kind === 'foundation' && selection.suit === suit} />
                )}
              </button>
            );
          })}
        </div>

        <div className="cnm-row cnm-columns">
          {state.tableau.map((column, colIdx) => {
            const down = state.faceDown[colIdx] ?? 0;
            const top = column[column.length - 1] ?? null;
            return (
              <div
                className="cnm-column"
                key={colIdx}
                onClick={() => column.length === 0 && onTableauClick(colIdx, null)}
                style={{ height: `calc(var(--cw) * ${columnHeight(column.length, down)})` }}
              >
                {column.length === 0 ? <span className="cnm-slot-hint">K</span> : null}
                {column.map((card, idx) => {
                  const isDown = idx < down;
                  const offset = Math.min(idx, down) * 0.14 + Math.max(idx - down, 0) * 0.32;
                  const isSelected =
                    selection?.kind === 'tableau' &&
                    selection.column === colIdx &&
                    column.findIndex((c) => c.id === selection.cardId) <= idx;
                  return (
                    <button
                      aria-label={isDown ? 'Carta virada para baixo' : cardName(card)}
                      className="cnm-stacked"
                      disabled={isDown}
                      key={card.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTableauClick(colIdx, card);
                      }}
                      onDoubleClick={() => card === top && sendSelectionToFoundation({ kind: 'tableau', column: colIdx, cardId: card.id })}
                      style={{ top: `calc(var(--cw) * ${offset})` }}
                      type="button"
                    >
                      {isDown ? <CardBack /> : <CardFace card={card} selected={isSelected} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-6 text-sm text-amber-200" role="status">
        {message}
      </p>

      {won ? (
        <div className="cnm-win" role="alertdialog" aria-label="Vitória">
          <p className="text-3xl font-bold">Você venceu! 🎉</p>
          <p className="text-sm">{state.moves} movimentos</p>
          <button className="cnm-btn cnm-btn-gold" onClick={restart} type="button">
            Jogar de novo
          </button>
        </div>
      ) : null}
    </section>
  );
}
