import type { SeatDescription } from '../ui/presentation';

/**
 * Lista de assentos da sala.
 *
 * Uma lista de verdade (`<ul>`/`<li>`), com texto que faz sentido **sem
 * cor**: a presença aparece como "presente"/"ausente" e o turno como "é o
 * turno de Ana" (regra de acessibilidade: cor nunca é o único indicador).
 */
export interface SeatListProps {
  readonly seats: readonly SeatDescription[];
}

export function SeatList({ seats }: SeatListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {seats.length === 0 ? (
        <li className="text-sm text-stone-700">Nenhum jogador sentado ainda.</li>
      ) : (
        seats.map((seat) => (
          <li
            className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-stone-300 bg-white px-3 py-2"
            key={seat.playerId}
          >
            <span className="font-semibold text-stone-900">{seat.nickname}</span>
            <span className="text-sm text-stone-700">
              Assento {seat.seatIndex + 1} · {seat.avatarLabel}
            </span>
            <span className="text-sm text-stone-700">— {seat.presenceLabel}</span>
            {seat.handCount === null ? null : (
              <span className="text-sm text-stone-700">
                — {seat.handCount === 1 ? '1 carta' : `${seat.handCount} cartas`} na mão
              </span>
            )}
            {seat.turnLabel === null ? null : (
              <span className="text-sm font-semibold text-stone-900">— {seat.turnLabel}</span>
            )}
          </li>
        ))
      )}
    </ul>
  );
}
