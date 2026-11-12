import { useEffect, useState } from 'react';

import { patienceGame, type PatienceState, type PatienceActionPayload, type PatienceEvent } from '@cartas-na-mesa/core';

/**
 * Mapeamento de naipes do core para nomes de arquivos de asset.
 * O core usa nomes internos (ouro, copa, espada, paus) e os mapeamos
 * para os arquivos reais que estão em Cards/.
 * convenção de nomes: card_diamond, card_heart, card_spade, card_clubs
 * (naipes portugueses: ouros=diamonds, copas=hearts, espadas=spades, paus=clubs).
 */
const suitAssetMap: Record<string, string> = {
  ouro: 'card_diamond',
  copa: 'card_heart',
  espada: 'card_spade',
  paus: 'card_clubs',
};

/**
 * Componente de mesa de Paciência (Klondike) – modo single-player.
 *
 * Mobile‑first: layout vertical em small, reflow horizontal em md+.
 * Todas as interações passam pelo núcleo determinístico via `applyAction`.
 * É necessário clicar em "Nova Partida" para iniciar um novo jogo.
 */
export default function PatienceTable() {
  const [showGame, setShowGame] = useState(false);
  const [state, setState] = useState<PatienceState | null>(null);
  const [events, setEvents] = useState<readonly PatienceEvent[]>([]);

  // --- Botão “Nova Partida” ---
  const handleNewGame = () => {
    setShowGame(true);
  };

  // --- Inicializa partida ao aceitar mostrar o jogo ---
  useEffect(() => {
    if (!showGame) return;
    const seed = Date.now() % 10000; // seed diferente a cada nova partida
    const players = [
      {
        playerId: 'player-1',
        seatIndex: 0,
        nickname: 'Você',
        avatarId: null,
      } as const,
    ];
    const rng = patienceGame.createSeededRng
      ? patienceGame.createSeededRng(seed)
      : {
          nextUint32: () => 0,
        } as const;
    const initial = patienceGame.createInitialState(players, rng);
    setState(initial);
    setEvents([]);
  }, [showGame]);

  // --- Se não houver estado, mostra tela inicial ---
  if (!state) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center text-stone-700">
        <p>Clique em "Nova Partida" para começar um jogo de Paciência</p>
        <button
          className="cnm-interactive mt-4 rounded-md bg-stone-900 px-4 py-2 font-semibold text-stone-50"
          onClick={handleNewGame}
          type="button"
        >
Nova Partida
        </button>
      </div>
    );
  }

  // --- Função para obter URL da carta ---
  const getCardUrl = (card: PatienceCard, assetKey: keyof typeof suitAssetMap) => {
    const idx = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(card.value) + 1;
    return `/Cards/${suitAssetMap[assetKey]}_${idx}.png`;
  };

  // --- Aplica ação no núcleo determinístico e atualiza estado/local events ---
  function handleAction(action: PatienceActionPayload) {
    const result = patienceGame.applyAction(state!, action);
    if (result.ok) {
      setState(result.state);
      setEvents((ev) => [...ev, ...result.events]);
    } else {
      console.error('Ação inválida:', result.error);
    }
  }

  // --- Helpers de UI ---
  const wasteTop = state.waste[state.waste.length - 1];

  // --- Render ---
  return (
    <div className="min-h-[500px] bg-green-600/60 relative p-4 rounded-lg shadow-xl">
      {/* ----- Header com botão Nova Partida ----- */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-medium text-stone-200">Paciência (Klondike)</h2>
        <button
          className="cnm-interactive rounded-md bg-stone-900 px-3 py-1 font-sm text-stone-50"
          onClick={handleNewGame}
          type="button"
        >
Nova Partida
        </button>
      </div>

      {/* Instruções */}
      <p className="text-xs opacity-80">
        Clique em stock para virar | Clique em cartas para mover | Objetivo: mover Ás→Rei por naipe
      </p>

      {/* Stock (monte principal) */}
      <div
        className="relative cursor-pointer select-none"
        onClick={() => {
          if (state?.stock.length > 0) handleAction({ type: 'flip_stock' });
        }}
        title={state?.stock.length > 0 ? 'Virar stock' : 'Stock vazio'}
        aria-disabled={!((state?.stock.length ?? 0) > 0)}
        style={{ opacity: ((state?.stock.length ?? 0) > 0) ? 1 : 0.5 }}
      >
        <div className="w-14 h-20 bg-green-800 text-white font-bold rounded border border-stone-600 flex items-center justify-center select-none">
          {state?.stock.length > 0 ? `${state.stock.length}` : ''}
        </div>
        {state?.stock.length > 0 && (
          <div className="absolute -inset-1 rounded-md bg-green-800/50 backdrop-blur"></div>
        )}
      </div>

      {/* Waste (descarte) */}
      {state?.waste.length > 0 && (
        <div
          className="relative w-14 h-20 mb-4 bg-white rounded border border-stone-600 select-none"
          title="Carta no descarte"
        >
          <div
            className="absolute inset-0 flex items-center justify-center text-sm text-green-800 font-semibold"
          >
            {state.waste[state.waste.length - 1]?.value === 'A'
              ? '1'
              : state.waste[state.waste.length - 1]?.value === 'K'
              ? 'K'
              : state.waste[state.waste.length - 1]?.value?.charAt(0) || ''}
          </div>
        </div>
      )}

      {/* Tableau - 7 colunas */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {state?.tableau.map((column, colIdx) => (
          <div
            key={colIdx}
            className="relative rounded-border border-stone-600 bg-stone-800 p-1 min-h-[120px] transition-colors hover:bg-stone-700"
            title={`Coluna ${colIdx + 1}: ${column.length} carta(s)`}
          >
            {column.map((card, cardIdx) => (
              <div
                key={cardIdx}
                className="relative w-10 h-14 mb-1 rounded-t border border-stone-500 bg-white select-none ring-2 ring-green-500 opacity-100"
                title={card.value}
                style={{ backgroundImage: getCardUrl(card, card.suit as keyof typeof suitAssetMap) }}
                aria-label={`Carta ${card.value} de ${card.suit}`}
                onClick={() => handleCardClick(colIdx, card)}
              >
                <span className="absolute top-0 left-0 w-full h-full text-center text-xs text-green-400 font-medium">{card.value}</span>
              </div>
            ))}
            {column.length > 1 && (
              <div className="absolute bottom-0 left-0 right-0 p-1 text-xs text-stone-400">
                +{column.length - 1} mais viradas para baixo
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Fundações (4 pilhas) - com imagens de cartas */}
{[0, 1, 2, 3].map((suitIdx) => {
  const suit: 'ouro' | 'copa' | 'espada' | 'paus' = ['ouro', 'copa', 'espada', 'paus'][suitIdx];
  const pile = state?.foundations?.[suitIdx];
  const topCard = pile?.[pile.length - 1];
  return (
    <div
      key={suit}
      className="w-14 h-20 rounded-br-md border border-stone-600 bg-green-900 flex items-center justify-center select-none cursor-pointer hover:bg-green-800 transition-colors"
      title={`Fundaçāo: ${pile?.length ?? 0} carta(s)`}
    >
      {pile?.length > 0 ? (
        <div
          className="relative w-full h-full"
          style={{
            backgroundImage:
              topCard !== null
                ? `/Cards/${suitAssetMap[suit]}_${['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(topCard.value) + 1}.png`
                : 'none',
          }}
        >
          <span
            className="absolute top-0 left-0 w-full h-full text-center text-xs text-green-400 font-medium"
          >
            {topCard?.value}
          </span>
        </div>
      ) : (
        <div className="opacity-50 text-white">vazio</div>
      )}
    </div>
  );
})}

      {/* Células livres */}
      <div className="mt-6 flex justify-between">
{[0, 1, 2, 3].map((slotIdx) => (
  <div
    key={slotIdx}
    className={`relative w-10 h-14 ${state?.freeCells?.[slotIdx] ? 'bg-white' : 'bg-stone-800'} rounded border border-stone-600 select-none cursor-pointer hover:bg-stone-700`}
    title={state?.freeCells?.[slotIdx]
      ? `Carta: ${state.freeCells[slotIdx].value}`
      : 'Célula livre vazia'}
    onClick={() => handleFreeCellClick(slotIdx)}
  >
    {state?.freeCells?.[slotIdx] ? (
      <div className="absolute inset-0 flex items-center justify-center text-xs text-green-600 font-medium">
        {state.freeCells[slotIdx].value}
      </div>
    ) : (
      <span className="absolute top-1 left-1 text-xs text-stone-400">□</span>
    )}
  </div>
))}
      </div>

      {/* Eventos recentes */}
      <div className="mt-6 text-xs text-stone-300 max-h-48 overflow-y-auto">
{(events.map((ev, i) => {
  const typeLabels: Record<string, string> = {
    card_moved: 'Carta movida',
    turn_changed: 'Vez alterada',
    game_finished: 'Partida finalizada',
  };
  const label = typeLabels[ev.type] || ev.type;
  return <div key={i} className="flex items-start gap-2">
    <span className="text-stone-500">▸</span>
    <span>{`${label}: ${ev.cardId ?? ''}`}</span>
  </div>;
})}
      </div>
    </div>
  );
}

/* ---------- Handlers de clique ---------- */

// Clique em “Nova Partida”
function handleNewGame() {
  setShowGame(true);
}

// Clique em carta do tableau
function handleCardClick(fromColumn: number, card: PatienceCard) {
  // 1. Mover para fundação
  for (let s = 0; s < 4; s += 1) {
    if (patienceGame.canMoveToFoundations(card, state?.foundations?.[s] as readonly PatienceCard[], card.suit)) {
      const action: PatienceActionPayload = {
        type: 'move_from_tableau_to_foundations',
        fromColumn,
        suit: card.suit,
      };
      handleAction(action);
      return;
    }
  }

  // 2. Mover para célula livre (primeira vaga)
  for (let slot = 0; slot < 4; slot += 1) {
    if (!state?.freeCells?.[slot]) {
      const action: PatienceActionPayload = {
        type: 'move_from_tableau_to_free_cell',
        fromColumn,
        cardId: card.id,
      };
      handleAction(action);
      return;
    }
  }

  // 3. Mover para outra coluna do tableau
  for (let toColumn = 0; toColumn < 7; toColumn += 1) {
    const target = state?.tableau?.[toColumn];
    if (!target?.length) {
      if (card.value === 'K') {
        const action: PatienceActionPayload = {
          type: 'move_from_tableau_to_tableau',
          fromColumn,
          toColumn,
          cardId: card.id,
        };
        handleAction(action);
        return;
      }
    } else {
      const topOfTarget = target[target.length - 1];
      const cardIdx = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(card.value);
      const topIdx = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(topOfTarget.value);
      if (cardIdx === topIdx - 1 && card.color !== topOfTarget.color) {
        const action: PatienceActionPayload = {
          type: 'move_from_tableau_to_tableau',
          fromColumn,
          toColumn,
          cardId: card.id,
        };
        handleAction(action);
        return;
      }
    }
  }
}

// Clique em célula livre
function handleFreeCellClick(slotIdx: number) {
  const card = state?.freeCells?.[slotIdx];
  if (!card) return;

  // 1. Para fundação
  for (let s = 0; s < 4; s += 1) {
    if (patienceGame.canMoveToFoundations(card, state?.foundations?.[s] as readonly PatienceCard[], card.suit)) {
      const action: PatienceActionPayload = {
        type: 'move_from_free_cell_to_foundations',
        cardId: card.id,
        suit: card.suit,
      };
      handleAction(action);
      return;
    }
  }

  // 2. Para tableau
  for (let col = 0; col < 7; col += 1) {
    const target = state?.tableau?.[col];
    if (!target?.length) {
      if (card.value === 'K') {
        const action: PatienceActionPayload = {
          type: 'move_from_free_cell_to_tableau',
          cardId: card.id,
          targetColumn: col,
        };
        handleAction(action);
        return;
      }
    } else {
      const topOfTarget = target[target.length - 1];
      const cardIdx = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(card.value);
      const topIdx = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(topOfTarget.value);
      if (cardIdx === topIdx - 1 && card.color !== topOfTarget.color) {
        const action: PatienceActionPayload = {
          type: 'move_from_free_cell_to_tableau',
          cardId: card.id,
          targetColumn: col,
        };
        handleAction(action);
        return;
      }
    }
  }
}

// Clique em fundação (mover Rei de volta para coluna vazia)
function handleFoundationClick(suitIdx: number) {
  const pile = state?.foundations?.[suitIdx];
  if (!pile?.length) return;
  const topCard = pile[pile.length - 1];
  if (topCard.value !== 'K') return;

  for (let col = 0; col < 7; col += 1) {
    if (!state?.tableau?.[col]?.length) {
      const action: PatienceActionPayload = {
        type: 'move_from_tableau_to_tableau',
        fromColumn: -1,
        toColumn: col,
        cardId: topCard.id,
      };
      handleAction(action);
      return;
    }
  }
}
