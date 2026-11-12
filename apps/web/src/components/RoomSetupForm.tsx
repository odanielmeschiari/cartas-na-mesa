import type { FormEvent } from 'react';

import { NICKNAME_MAX_LENGTH } from '../ui/presentation';

/**
 * Formulário de entrada: apelido e código da sala.
 *
 * Semântica: um `<form>` com `<label for>` visível para cada campo e dois
 * botões `type="submit"`.
 *
 * **Por que `submit` e não `button`:** o envio por `Enter` no campo é o
 * comportamento esperado de um formulário, e `type="submit"` é o que o
 * navegador usa para oferecer essa tecla. `type="button"` desligaria esse
 * caminho e entregaria ao JavaScript a responsabilidade de tratar o
 * `Enter` — sem ganho de acessibilidade.
 *
 * Os dois botões compartilham o mesmo `onSubmit`; a intenção vem do próprio
 * botão que disparou o envio, pelo par `name`/`value` lido do `submitter` do
 * evento (`readIntent` abaixo), que é a forma padrão do DOM de distinguir o
 * botão que acionou o envio.
 *
 * A validação é da **UI** (`noValidate`): as mensagens ficam visíveis no
 * formulário e ligadas ao campo por `aria-describedby`, em vez de depender do
 * balão do navegador.
 */
export interface RoomSetupFormProps {
  readonly nickname: string;
  readonly roomCode: string;
  readonly nicknameError: string | null;
  readonly roomCodeError: string | null;
  readonly busy: boolean;
  readonly onNicknameChange: (value: string) => void;
  readonly onRoomCodeChange: (value: string) => void;
  readonly onSubmit: (intent: 'create' | 'join') => void;
}

/**
 * Intenção do envio, lida do botão que disparou o formulário.
 *
 * O `submitter` é a informação padrão do DOM para isso; quando não existe
 * (envio programático), o padrão é "criar sala".
 */
function readIntent(event: FormEvent<HTMLFormElement>): 'create' | 'join' {
  const nativeEvent = event.nativeEvent;
  if (!('submitter' in nativeEvent)) {
    return 'create';
  }

  const submitter = nativeEvent.submitter;
  if (!(submitter instanceof HTMLElement)) {
    return 'create';
  }

  return submitter.getAttribute('value') === 'join' ? 'join' : 'create';
}

export function RoomSetupForm({
  nickname,
  roomCode,
  nicknameError,
  roomCodeError,
  busy,
  onNicknameChange,
  onRoomCodeChange,
  onSubmit,
}: RoomSetupFormProps) {
  const hasCode = roomCode.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(readIntent(event));
  };

  return (
    <form className="flex flex-col gap-4 cnm-panel" noValidate onSubmit={handleSubmit}>
      <h2 className="text-lg font-bold">Entrar na mesa</h2>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold" htmlFor="nickname">
          Apelido
        </label>
        <input
          aria-describedby={nicknameError === null ? undefined : 'nickname-error'}
          aria-invalid={nicknameError === null ? undefined : true}
          autoComplete="nickname"
          className="cnm-input text-stone-900"
          disabled={busy}
          id="nickname"
          maxLength={NICKNAME_MAX_LENGTH}
          name="nickname"
          onChange={(event) => onNicknameChange(event.target.value)}
          type="text"
          value={nickname}
        />
        {nicknameError === null ? null : (
          <p className="text-sm font-semibold text-red-900" id="nickname-error">
            {nicknameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-semibold" htmlFor="room-code">
          Código da sala (opcional)
        </label>
        <input
          aria-describedby={
            roomCodeError === null ? 'room-code-hint' : 'room-code-hint room-code-error'
          }
          aria-invalid={roomCodeError === null ? undefined : true}
          autoCapitalize="characters"
          autoComplete="off"
          className="cnm-input uppercase text-stone-900"
          disabled={busy}
          id="room-code"
          name="roomCode"
          onChange={(event) => onRoomCodeChange(event.target.value)}
          spellCheck={false}
          type="text"
          value={roomCode}
        />
        <p className="text-sm text-stone-700" id="room-code-hint">
          Deixe em branco para criar uma sala nova.
        </p>
        {roomCodeError === null ? null : (
          <p className="text-sm font-semibold text-red-900" id="room-code-error">
            {roomCodeError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* O primeiro botão é o que o Enter aciona: com código digitado, ele entra na sala. */}
        <button
          className="cnm-btn cnm-btn-dark"
          disabled={busy}
          name="action"
          type="submit"
          value={hasCode ? 'join' : 'create'}
        >
          {hasCode ? 'Entrar na sala' : 'Criar sala'}
        </button>
        {hasCode ? (
          <button
            className="cnm-btn cnm-btn-light"
            disabled={busy}
            name="action"
            type="submit"
            value="create"
          >
            Criar sala nova
          </button>
        ) : null}
      </div>
    </form>
  );
}
