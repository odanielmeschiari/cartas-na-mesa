import { useState } from 'react';

/**
 * Botão que copia o código da sala.
 *
 * O código da sala é a credencial de compartilhamento: ele é exibido em texto
 * e pode ser copiado com um clique. O resultado da cópia é anunciado por uma
 * região `role="status"`, para quem não enxerga a mudança do rótulo.
 */
export interface CopyRoomCodeButtonProps {
  readonly roomCode: string | null;
}

export function CopyRoomCodeButton({ roomCode }: CopyRoomCodeButtonProps) {
  const [feedback, setFeedback] = useState('');

  const handleCopy = async (): Promise<void> => {
    if (roomCode === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(roomCode);
      setFeedback('Código copiado.');
    } catch {
      setFeedback('Não foi possível copiar. Copie o código exibido acima.');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="cnm-btn cnm-btn-light"
        disabled={roomCode === null}
        onClick={() => void handleCopy()}
        type="button"
      >
        Copiar código
      </button>
      <p aria-live="polite" className="text-sm text-stone-700" role="status">
        {feedback}
      </p>
    </div>
  );
}
