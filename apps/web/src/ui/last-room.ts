import { createMemoryStorage, type KeyValueStorage } from '../client/session-store';

/**
 * Guarda local do **código da sala** em que o jogador esteve por último.
 *
 * A `session-store` guarda o token de sessão **por sala**, mas não sabe
 * qual sala é a última: o token só é recuperável se o código também for
 * lembrado. Este módulo guarda só esse código — nenhum segredo, nenhum dado
 * pessoal (regra 5): o código da sala é o identificador opaco que o jogador
 * compartilha com quem quer jogar.
 *
 * O storage é injetado, como na `session-store`, para que o teste use um
 * dublê em memória e a aplicação não dependa do navegador.
 */

const LAST_ROOM_KEY = 'cnm:last-room';

/** Guarda local do código da sala em que o jogador esteve por último. */
export interface LastRoomStore {
  load(): string | null;
  save(roomCode: string): void;
  clear(): void;
}

/**
 * Cria a guarda sobre um storage injetado.
 *
 * Nenhuma operação lança: um storage que falhe degrada para "não há sala
 * guardada", sem derrubar a aplicação.
 */
export function createLastRoomStore(storage: KeyValueStorage): LastRoomStore {
  return {
    load(): string | null {
      let raw: string | null;
      try {
        raw = storage.getItem(LAST_ROOM_KEY);
      } catch {
        return null;
      }

      if (raw === null) {
        return null;
      }

      const roomCode = raw.trim();
      if (roomCode.length === 0) {
        storage.removeItem(LAST_ROOM_KEY);
        return null;
      }

      return roomCode;
    },

    save(roomCode: string): void {
      const normalized = typeof roomCode === 'string' ? roomCode.trim() : '';
      if (normalized.length === 0) {
        storage.removeItem(LAST_ROOM_KEY);
        return;
      }

      storage.setItem(LAST_ROOM_KEY, normalized);
    },

    clear(): void {
      storage.removeItem(LAST_ROOM_KEY);
    },
  };
}

/**
 * Storage do navegador, com **fallback explícito** para a memória.
 *
 * O `localStorage` pode lançar no acesso (modo privado, cookies bloqueados) e
 * também na escrita (cota estourada). A sondagem abaixo escreve e apaga uma
 * chave: é a única forma de saber que a escrita funciona.
 */
function resolveBrowserStorage(): KeyValueStorage {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return createMemoryStorage();
    }

    const storage = window.localStorage;
    const probeKey = 'cnm:last-room-probe';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);

    return storage;
  } catch {
    return createMemoryStorage();
  }
}

/** Guarda do código da sala sobre o `localStorage`, quando ele funciona. */
export function createBrowserLastRoomStore(): LastRoomStore {
  return createLastRoomStore(resolveBrowserStorage());
}
