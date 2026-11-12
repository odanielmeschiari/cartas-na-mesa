import { CopyRoomCodeButton } from './CopyRoomCodeButton';
import { HandList } from './HandList';
import { SeatList } from './SeatList';
import type { RoomDescription } from '../ui/presentation';

/**
 * Tela da sala: código da sala, assentos, estado público e visão privada.
 *
 * A ordem dos títulos é `h2` dentro da sala (o `h1` é o da página), e cada
 * seção é rotulada por `aria-labelledby`, para que o leitor de tela possa
 * navegar entre elas.
 */
export interface RoomPanelProps {
  readonly room: RoomDescription;
  readonly onPlayCard: (cardId: string) => void;
  readonly onLeave: () => void;
}

export function RoomPanel({ room, onPlayCard, onLeave }: RoomPanelProps) {
  const publicState = room.publicState;
  const privateState = room.privateState;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="room-heading" className="flex flex-col gap-3 cnm-panel">
        <h2 className="text-lg font-bold" id="room-heading">
          Sala
        </h2>

        <dl className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-sm font-semibold text-stone-700">Código da sala</dt>
            <dd className="cnm-code">{room.roomCode ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-sm font-semibold text-stone-700">Partida (depuração)</dt>
            <dd className="break-all text-xs text-stone-700">
              <code>{room.matchId ?? '—'}</code>
            </dd>
          </div>
        </dl>

        <CopyRoomCodeButton roomCode={room.roomCode} />

        <p aria-live="polite" className="text-sm font-semibold text-stone-900" role="status">
          {room.connectionLabel}
        </p>

        <div>
          <button className="cnm-btn cnm-btn-light" onClick={onLeave} type="button">
            Sair da sala
          </button>
        </div>
      </section>

      <section aria-labelledby="seats-heading" className="flex flex-col gap-3 cnm-panel">
        <h2 className="text-lg font-bold" id="seats-heading">
          Assentos
        </h2>
        <SeatList seats={room.seats} />
      </section>

      <section aria-labelledby="public-heading" className="flex flex-col gap-3 cnm-panel">
        <h2 className="text-lg font-bold" id="public-heading">
          Mesa (estado público)
        </h2>

        {publicState === null ? (
          <p className="text-sm text-stone-700">A partida ainda não começou.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm text-stone-900">
              <li>Status: {publicState.statusLabel}</li>
              <li>{publicState.turnLabel}</li>
            </ul>

            <h3 className="text-base font-semibold">Tamanhos das mãos</h3>
            <ul className="flex flex-col gap-1 text-sm text-stone-900">
              {publicState.handSizes.length === 0 ? (
                <li className="text-stone-700">Nenhuma mão visível.</li>
              ) : (
                publicState.handSizes.map((entry) => (
                  <li key={entry.nickname}>
                    {entry.nickname}: {entry.label}
                  </li>
                ))
              )}
            </ul>

            <h3 className="text-base font-semibold">Cartas na mesa</h3>
            {publicState.table.length === 0 ? (
              <p className="text-sm text-stone-700">Nenhuma carta na mesa.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-stone-900">
                {publicState.table.map((entry, index) => (
                  <li key={`${entry.cardId}-${index}`}>{entry.label}</li>
                ))}
              </ul>
            )}

            {publicState.resultLabel === null ? null : (
              <p className="text-sm font-semibold text-stone-900">{publicState.resultLabel}</p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="hand-heading" className="flex flex-col gap-3 cnm-panel">
        <h2 className="text-lg font-bold" id="hand-heading">
          Sua mão (visão privada)
        </h2>
        <HandList hand={privateState} onPlayCard={onPlayCard} />
      </section>
    </div>
  );
}
