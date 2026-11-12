import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createSeededRng,
  patienceGame,
  PATIENCE_SUITS,
  type PatienceActionPayload,
  type PatienceCard,
  type PatienceState,
  type PatienceSuit,
} from '@cartas-na-mesa/core';

import { isMuted, playSound, preloadSounds, setMuted } from '../ui/sounds';
import { cardBackUrl, cardFaceUrl, cardName, SUIT_SYMBOL } from '../ui/card-assets';

const PLAYER_ID = 'player-1';
const PLAYERS = [{ playerId: PLAYER_ID, seatIndex: 0, nickname: 'Você', avatarId: null }] as const;

type Selection =
  | { kind: 'waste' }
  | { kind: 'tableau'; column: number; cardId: string }
  | { kind: 'foundation'; suit: PatienceSuit };

type DragSource =
  | { kind: 'waste' }
  | { kind: 'tableau'; column: number; index: number }
  | { kind: 'foundation'; suit: PatienceSuit };

type DragState = {
  source: DragSource;
  cards: readonly PatienceCard[];
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
};

type Phase = 'shuffling' | 'dealing' | 'playing';

/** Ordem real de distribuição do Klondike: fileira por fileira, da esquerda para a direita. */
const DEAL_ORDER: ReadonlyMap<string, number> = (() => {
  const order = new Map<string, number>();
  for (let row = 0; row < 7; row += 1) {
    for (let col = row; col < 7; col += 1) order.set(`${col}-${row}`, order.size);
  }
  return order;
})();
const DEAL_TOTAL = DEAL_ORDER.size;
const SHUFFLE_MS = 1050;
const DEAL_INTERVAL_MS = 70;

function newGame(): PatienceState {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
  return patienceGame.createInitialState(PLAYERS, createSeededRng(seed));
}

/** Altura (em larguras de carta) de uma coluna com as cartas empilhadas. */
function columnHeight(total: number, down: number): number {
  const downCount = Math.min(down, total);
  return (
    1.35 + downCount * 0.14 + Math.max(total - downCount - 1, 0) * 0.32 + (total === 0 ? 0 : 0)
  );
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
export default function PatienceTable({ onExit }: { readonly onExit: () => void }) {
  const [state, setState] = useState<PatienceState>(() => newGame());
  const [history, setHistory] = useState<readonly PatienceState[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [phase, setPhase] = useState<Phase>('shuffling');
  const [dealt, setDealt] = useState(0);
  const [muted, setMutedState] = useState(isMuted);
  const [round, setRound] = useState(0);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => setMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);

  // Início da partida: embaralha (1s) e depois distribui uma carta por vez.
  useEffect(() => {
    preloadSounds();
    setPhase('shuffling');
    setDealt(0);
    playSound('shuffle');

    let interval: number | undefined;
    const timer = window.setTimeout(() => {
      setPhase('dealing');
      let count = 0;
      interval = window.setInterval(() => {
        count += 1;
        setDealt(count);
        playSound('draw');
        if (count >= DEAL_TOTAL) {
          window.clearInterval(interval);
          setPhase('playing');
        }
      }, DEAL_INTERVAL_MS);
    }, SHUFFLE_MS);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [round]);

  const run = useCallback(
    (payload: PatienceActionPayload): boolean => {
      const result = patienceGame.applyAction(state, { playerId: PLAYER_ID, payload });
      if (!result.ok) {
        setMessage(result.error.message);
        return false;
      }
      playSound(payload.type === 'flip_stock' ? 'draw' : 'move');
      setHistory((h) => [...h, state]);
      setState(result.state);
      setSelection(null);
      return true;
    },
    [state],
  );

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const dropOn = (source: DragSource, cards: readonly PatienceCard[], target: string): void => {
    const first = cards[0];
    if (first === undefined) return;
    if (target.startsWith('col-')) {
      const toColumn = Number(target.slice(4));
      if (source.kind === 'waste') runRef.current({ type: 'waste_to_tableau', toColumn });
      else if (source.kind === 'tableau') {
        if (source.column !== toColumn) {
          runRef.current({
            type: 'tableau_to_tableau',
            fromColumn: source.column,
            toColumn,
            cardId: first.id,
          });
        }
      } else runRef.current({ type: 'foundation_to_tableau', suit: source.suit, toColumn });
    } else if (target === 'found') {
      if (source.kind === 'waste') runRef.current({ type: 'waste_to_foundation' });
      else if (source.kind === 'tableau' && cards.length === 1) {
        runRef.current({ type: 'tableau_to_foundation', fromColumn: source.column });
      }
    }
  };

  /** Arrastar: começa só depois de mover alguns pixels; antes disso vale o clique. */
  const beginPointer = (
    e: React.PointerEvent<HTMLElement>,
    source: DragSource,
    cards: readonly PatienceCard[],
  ) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { source, cards, dx: startX - rect.left, dy: startY - rect.top, w: rect.width };
    let active = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    function move(ev: PointerEvent) {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        active = true;
        setSelection(null);
      }
      setDrag({ ...base, x: ev.clientX, y: ev.clientY });
    }
    function end(ev: PointerEvent) {
      cleanup();
      if (!active) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 80);
      setDrag(null);
      if (ev.type === 'pointercancel') return;
      const target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-drop]');
      if (target?.dataset.drop !== undefined) dropOn(source, cards, target.dataset.drop);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const restart = () => {
    setState(newGame());
    setRound((r) => r + 1);
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
    if (suppressClick.current) return;
    if (selection === null) {
      if (card !== null) setSelection({ kind: 'tableau', column, cardId: card.id });
      return;
    }
    if (selection.kind === 'tableau' && selection.column === column) {
      setSelection(
        card === null || selection.cardId === card.id
          ? null
          : { kind: 'tableau', column, cardId: card.id },
      );
      return;
    }
    const moved =
      selection.kind === 'waste'
        ? run({ type: 'waste_to_tableau', toColumn: column })
        : selection.kind === 'tableau'
          ? run({
              type: 'tableau_to_tableau',
              fromColumn: selection.column,
              toColumn: column,
              cardId: selection.cardId,
            })
          : run({ type: 'foundation_to_tableau', suit: selection.suit, toColumn: column });
    if (!moved && card !== null) setSelection({ kind: 'tableau', column, cardId: card.id });
  };

  const onFoundationClick = (suit: PatienceSuit) => {
    if (suppressClick.current) return;
    const pile = state.foundations[PATIENCE_SUITS.indexOf(suit)] ?? [];
    if (selection === null) {
      if (pile.length > 0) setSelection({ kind: 'foundation', suit });
      return;
    }
    if (!sendSelectionToFoundation(selection) && selection.kind === 'foundation')
      setSelection(null);
  };

  const wasteTop = state.waste[state.waste.length - 1];
  const inFoundations = state.foundations.reduce((sum, pile) => sum + pile.length, 0);
  const won = state.status === 'finished';

  return (
    <section aria-label="Mesa de Paciência" className="cnm-felt cnm-fullscreen">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-3">
          <button className="cnm-btn" onClick={onExit} type="button">
            ← Voltar
          </button>
          <p className="text-sm font-semibold text-emerald-50" role="status">
            Movimentos: {state.moves} · Fundações: {inFoundations}/52
          </p>
        </div>
        <div className="flex gap-2">
          <button
            aria-pressed={muted}
            className="cnm-btn"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            type="button"
          >
            {muted ? '🔇 Som desligado' : '🔊 Som'}
          </button>
          <button className="cnm-btn" disabled={history.length === 0} onClick={undo} type="button">
            Desfazer
          </button>
          <button className="cnm-btn" onClick={restart} type="button">
            Nova partida
          </button>
        </div>
      </div>

      <div className="cnm-board-wrap">
        <div className={`cnm-board ${phase === 'playing' ? '' : 'cnm-busy'}`}>
          {phase === 'shuffling' ? (
            <div aria-hidden="true" className="cnm-shuffle">
              {Array.from({ length: 10 }, (_, i) => (
                <span
                  className="cnm-card cnm-card-back cnm-shuffle-card"
                  key={i}
                  style={{
                    ['--i' as string]: i,
                    ['--side' as string]: i % 2 === 0 ? -1 : 1,
                    backgroundImage: `url("${cardBackUrl() ?? ''}")`,
                  }}
                />
              ))}
            </div>
          ) : null}
          <div className="cnm-row">
            <button
              aria-label={
                state.stock.length > 0
                  ? `Virar carta do monte (${state.stock.length} restantes)`
                  : 'Reciclar o descarte no monte'
              }
              className="cnm-slot"
              onClick={() => run({ type: 'flip_stock' })}
              type="button"
            >
              {state.stock.length > 0 ? <CardBack /> : <span className="cnm-slot-hint">↻</span>}
            </button>

            <button
              aria-label={
                wasteTop === undefined ? 'Descarte vazio' : `Descarte: ${cardName(wasteTop)}`
              }
              className={`cnm-slot cnm-draggable ${drag?.source.kind === 'waste' ? 'cnm-hidden' : ''}`}
              disabled={wasteTop === undefined}
              onClick={() =>
                !suppressClick.current &&
                setSelection(selection?.kind === 'waste' ? null : { kind: 'waste' })
              }
              onPointerDown={(e) =>
                wasteTop !== undefined && beginPointer(e, { kind: 'waste' }, [wasteTop])
              }
              onDoubleClick={() => sendSelectionToFoundation({ kind: 'waste' })}
              type="button"
            >
              {wasteTop === undefined ? null : (
                <CardFace card={wasteTop} selected={selection?.kind === 'waste'} />
              )}
            </button>

            <span className="cnm-spacer" />

            {PATIENCE_SUITS.map((suit, i) => {
              const pile = state.foundations[i] ?? [];
              const top = pile[pile.length - 1];
              return (
                <button
                  aria-label={`Fundação de ${suit}: ${pile.length} carta(s)`}
                  className={`cnm-slot cnm-draggable ${drag?.source.kind === 'foundation' && drag.source.suit === suit ? 'cnm-hidden' : ''}`}
                  data-drop="found"
                  key={suit}
                  onClick={() => onFoundationClick(suit)}
                  onPointerDown={(e) =>
                    top !== undefined && beginPointer(e, { kind: 'foundation', suit }, [top])
                  }
                  type="button"
                >
                  {top === undefined ? (
                    <span className="cnm-slot-hint">{SUIT_SYMBOL[suit]}</span>
                  ) : (
                    <CardFace
                      card={top}
                      selected={selection?.kind === 'foundation' && selection.suit === suit}
                    />
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
                  data-drop={`col-${colIdx}`}
                  key={colIdx}
                  onClick={() => column.length === 0 && onTableauClick(colIdx, null)}
                  style={{ height: `calc(var(--cw) * ${columnHeight(column.length, down)})` }}
                >
                  {column.length === 0 ? <span className="cnm-slot-hint">K</span> : null}
                  {column.map((card, idx) => {
                    const order = DEAL_ORDER.get(`${colIdx}-${idx}`) ?? -1;
                    if (phase !== 'playing' && order >= dealt) return null;
                    const isDown = idx < down;
                    const offset = Math.min(idx, down) * 0.14 + Math.max(idx - down, 0) * 0.32;
                    const isSelected =
                      selection?.kind === 'tableau' &&
                      selection.column === colIdx &&
                      column.findIndex((c) => c.id === selection.cardId) <= idx;
                    return (
                      <button
                        aria-label={isDown ? 'Carta virada para baixo' : cardName(card)}
                        className={`cnm-stacked cnm-draggable ${phase === 'dealing' ? 'cnm-dealt' : ''} ${
                          drag?.source.kind === 'tableau' &&
                          drag.source.column === colIdx &&
                          idx >= drag.source.index
                            ? 'cnm-hidden'
                            : ''
                        }`}
                        disabled={isDown}
                        key={card.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTableauClick(colIdx, card);
                        }}
                        onPointerDown={(e) =>
                          !isDown &&
                          beginPointer(
                            e,
                            { kind: 'tableau', column: colIdx, index: idx },
                            column.slice(idx),
                          )
                        }
                        onDoubleClick={() =>
                          card === top &&
                          sendSelectionToFoundation({
                            kind: 'tableau',
                            column: colIdx,
                            cardId: card.id,
                          })
                        }
                        style={{
                          top: `calc(var(--cw) * ${offset})`,
                          ['--col' as string]: colIdx,
                          ['--off' as string]: offset,
                        }}
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
      </div>

      <p aria-live="polite" className="mt-2 min-h-6 text-sm text-amber-200" role="status">
        {message}
      </p>

      {drag === null ? null : (
        <div
          aria-hidden="true"
          className="cnm-ghost"
          style={{
            left: drag.x - drag.dx,
            top: drag.y - drag.dy,
            width: drag.w,
            ['--cw' as string]: `${drag.w}px`,
          }}
        >
          {drag.cards.map((c, i) => (
            <div
              key={c.id}
              style={{ position: 'absolute', left: 0, width: '100%', top: i * drag.w * 0.32 }}
            >
              <CardFace card={c} />
            </div>
          ))}
        </div>
      )}

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
