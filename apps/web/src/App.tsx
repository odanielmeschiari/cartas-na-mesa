import { useEffect, useState } from 'react';

import { ErrorBanner } from './components/ErrorBanner';
import { RoomPanel } from './components/RoomPanel';
import { RoomSetupForm } from './components/RoomSetupForm';
import { useSpikeClient } from './hooks/use-spike-client';
import { describeSnapshot, formatRoomCode, NICKNAME_MAX_LENGTH } from './ui/presentation';

/**
 * Tela do spike.
 *
 * Três estados, todos previstos e visíveis (regra de acessibilidade):
 * **vazio** (formulário de entrada), **carregando** (conectando ao servidor)
 * e **sala ativa** (código, assentos, estado público e visão privada).
 * O erro aparece na região `role="alert"`, acima de tudo.
 *
 * A UI não decide regra de jogo: ela mostra o que o servidor respondeu e
 * envia intenções (regra 9). O `sessionToken` nunca aparece na tela.
 */
export function App() {
  const spike = useSpikeClient();

  const [nickname, setNickname] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);

  // O apelido lembrado no navegador preenche o campo na primeira visita.
  useEffect(() => {
    const identity = spike.identity;
    if (identity === null) {
      return;
    }

    setNickname((current) => (current.trim().length === 0 ? identity.nickname : current));
  }, [spike.identity]);

  const snapshot = spike.snapshot;
  const room = snapshot === null ? null : describeSnapshot(snapshot);

  const handleSubmit = (intent: 'create' | 'join'): void => {
    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length === 0) {
      setNicknameError('Informe um apelido.');
      return;
    }
    if (trimmedNickname.length > NICKNAME_MAX_LENGTH) {
      setNicknameError(`O apelido deve ter no máximo ${NICKNAME_MAX_LENGTH} caracteres.`);
      return;
    }
    setNicknameError(null);

    if (intent === 'join') {
      const roomCode = formatRoomCode(roomCodeInput);
      if (roomCode.length === 0) {
        setRoomCodeError('Informe o código da sala.');
        return;
      }
      setRoomCodeError(null);
      void spike.joinRoom(trimmedNickname, roomCode);
      return;
    }

    setRoomCodeError(null);
    void spike.createRoom(trimmedNickname);
  };

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 text-stone-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Cartas na Mesa</h1>
          <p className="text-sm text-stone-700">
            Spike do jogo-fixture: duas conexões, uma sala, estado autoritativo.
          </p>
        </header>

        <ErrorBanner
          message={spike.error === null ? null : spike.error.message}
          onDismiss={spike.dismissError}
        />

        {spike.phase === 'in-room' && room !== null ? (
          <RoomPanel onLeave={spike.leaveRoom} onPlayCard={spike.playCard} room={room} />
        ) : (
          <>
            {spike.phase === 'connecting' ? (
              <p
                aria-live="polite"
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-900"
                role="status"
              >
                Conectando ao servidor…
              </p>
            ) : (
              <p className="text-sm text-stone-700">
                Nenhuma sala ativa. Crie uma sala ou entre com o código de uma sala.
              </p>
            )}

            {spike.phase === 'idle' && spike.resumeRoomCode !== null ? (
              <section
                aria-labelledby="resume-heading"
                className="flex flex-col gap-3 rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
              >
                <h2 className="text-lg font-semibold" id="resume-heading">
                  Retomar partida
                </h2>
                <p className="text-sm text-stone-900">
                  Há uma partida salva na sala <strong>{spike.resumeRoomCode}</strong>.
                </p>
                <div>
                  <button
                    className="cnm-interactive rounded-md bg-stone-900 px-4 py-2 font-semibold text-stone-50"
                    onClick={() => void spike.reconnectRoom()}
                    type="button"
                  >
                    Retomar partida
                  </button>
                </div>
              </section>
            ) : null}

            <RoomSetupForm
              busy={spike.phase === 'connecting'}
              nickname={nickname}
              nicknameError={nicknameError}
              onNicknameChange={(value) => {
                setNickname(value);
                if (nicknameError !== null) {
                  setNicknameError(null);
                }
              }}
              onRoomCodeChange={(value) => {
                setRoomCodeInput(value);
                if (roomCodeError !== null) {
                  setRoomCodeError(null);
                }
              }}
              onSubmit={handleSubmit}
              roomCode={roomCodeInput}
              roomCodeError={roomCodeError}
            />
          </>
        )}
      </div>
    </main>
  );
}
