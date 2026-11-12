/**
 * Persistência **local** da identidade anônima e do token de sessão.
 *
 * Regra 5 do `AGENTS.md`: identidade anônima e efêmera, guardada apenas no
 * navegador. Não há conta, servidor de perfil nem dado pessoal: só o apelido
 * e o avatar escolhidos pelo jogador, e o token da sessão de cada sala.
 *
 * O `Storage` é **injetado**, para que o teste use um dublê em memória e a
 * aplicação não dependa do navegador.
 */

/**
 * Subconjunto de `Storage` usado pela loja.
 *
 * O `Storage` do navegador satisfaz esta interface; um dublê em memória
 * também. A interface é estreita de propósito: o `Storage` do DOM exige a
 * assinatura de índice `[name: string]: any`, que um objeto simples em
 * memória não consegue implementar.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Identidade local do jogador: apelido e avatar escolhidos na entrada. */
export interface LocalIdentity {
  nickname: string;
  avatarId: string | null;
}

/** Guarda local de identidade e dos tokens de sessão, por sala. */
export interface SessionStore {
  loadIdentity(): LocalIdentity | null;
  saveIdentity(identity: LocalIdentity): void;
  loadSessionToken(roomCode: string): string | null;
  saveSessionToken(roomCode: string, token: string): void;
  clearSessionToken(roomCode: string): void;
}

const IDENTITY_KEY = 'cnm:identity';
const SESSION_TOKEN_PREFIX = 'cnm:session:';

/** Limites do contrato §2: apelido de 1 a 24 caracteres após `trim`. */
const NICKNAME_MAX_LENGTH = 24;

/**
 * Limite do `avatarId` no armazenamento local. O protocolo ainda não limita
 * o tamanho do `avatarId` (doc 0002 §8, item 11); a loja local limita para
 * não aceitar um valor absurdo vindo do storage.
 */
const AVATAR_ID_MAX_LENGTH = 64;

/** Verdadeiro para qualquer objeto não nulo. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Chave do token de sessão de uma sala. */
function sessionTokenKey(roomCode: string): string {
  return `${SESSION_TOKEN_PREFIX}${encodeURIComponent(roomCode)}`;
}

/**
 * Valida o conteúdo lido do storage. O storage local é **entrada hostil**
 * (regra 15): o que está gravado pode ter sido editado à mão, vir de outra
 * versão do app ou estar corrompido.
 */
function parseIdentity(raw: string): LocalIdentity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const nickname = parsed['nickname'];
  if (typeof nickname !== 'string') {
    return null;
  }

  const trimmedNickname = nickname.trim();
  if (trimmedNickname.length < 1 || trimmedNickname.length > NICKNAME_MAX_LENGTH) {
    return null;
  }

  const avatarId = parsed['avatarId'];
  if (avatarId === null) {
    return { nickname: trimmedNickname, avatarId: null };
  }

  if (typeof avatarId !== 'string') {
    return null;
  }

  const trimmedAvatarId = avatarId.trim();
  if (trimmedAvatarId.length < 1 || trimmedAvatarId.length > AVATAR_ID_MAX_LENGTH) {
    return null;
  }

  return { nickname: trimmedNickname, avatarId: trimmedAvatarId };
}

/** Normaliza o avatar para escrita: vazio vira `null` (avatar padrão). */
function normalizeAvatarId(avatarId: string | null): string | null {
  if (typeof avatarId !== 'string') {
    return null;
  }

  const trimmed = avatarId.trim();
  if (trimmed.length < 1 || trimmed.length > AVATAR_ID_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Cria a loja sobre um storage injetado.
 *
 * Nada é gravado fora do storage recebido, e nenhuma operação lança: um
 * storage que falhe degrada para "não há nada guardado", sem derrubar a
 * aplicação.
 */
export function createSessionStore(storage: KeyValueStorage): SessionStore {
  return {
    loadIdentity(): LocalIdentity | null {
      let raw: string | null;
      try {
        raw = storage.getItem(IDENTITY_KEY);
      } catch {
        return null;
      }

      if (raw === null) {
        return null;
      }

      const identity = parseIdentity(raw);
      if (identity === null) {
        // Dado inválido: a chave é apagada em vez de ficar polluting a loja.
        storage.removeItem(IDENTITY_KEY);
        return null;
      }

      return identity;
    },

    saveIdentity(identity: LocalIdentity): void {
      const rawNickname = typeof identity.nickname === 'string' ? identity.nickname : '';
      const nickname = rawNickname.trim().slice(0, NICKNAME_MAX_LENGTH);

      if (nickname.length === 0) {
        // Sem apelido válido não há identidade para lembrar.
        storage.removeItem(IDENTITY_KEY);
        return;
      }

      const avatarId = normalizeAvatarId(identity.avatarId);
      storage.setItem(IDENTITY_KEY, JSON.stringify({ nickname, avatarId }));
    },

    loadSessionToken(roomCode: string): string | null {
      const key = sessionTokenKey(roomCode);

      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch {
        return null;
      }

      if (raw === null) {
        return null;
      }

      const token = raw.trim();
      if (token.length === 0) {
        storage.removeItem(key);
        return null;
      }

      return token;
    },

    saveSessionToken(roomCode: string, token: string): void {
      const key = sessionTokenKey(roomCode);
      const normalized = typeof token === 'string' ? token.trim() : '';

      if (normalized.length === 0) {
        storage.removeItem(key);
        return;
      }

      storage.setItem(key, normalized);
    },

    clearSessionToken(roomCode: string): void {
      storage.removeItem(sessionTokenKey(roomCode));
    },
  };
}

/**
 * Storage em memória: usado quando o `localStorage` não está disponível
 * (navegador sem `window`, modo privado, cookies bloqueados). Os dados
 * existem só enquanto a aba estiver aberta.
 */
export function createMemoryStorage(): KeyValueStorage {
  const entries = new Map<string, string>();

  return {
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    removeItem: (key: string): void => {
      entries.delete(key);
    },
  };
}

/**
 * Storage do navegador, com **fallback explícito** para a memória.
 *
 * O `localStorage` pode lançar no acesso (modo privado, cookies bloqueados) e
 * também na escrita (cota estourada). A sondagem abaixo escreve e apaga uma
 * chave: é a única forma de saber que a escrita funciona. Qualquer falha cai
 * para o storage em memória — a aplicação continua funcionando, apenas sem
 * lembrar nada entre recargas.
 */
function resolveBrowserStorage(): KeyValueStorage {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return createMemoryStorage();
    }

    const storage = window.localStorage;
    const probeKey = 'cnm:probe';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);

    return storage;
  } catch {
    return createMemoryStorage();
  }
}

/**
 * Loja de sessão sobre o `localStorage` do navegador, quando ele funciona.
 * Nunca lança: no pior caso, degrade para o storage em memória.
 */
export function createBrowserSessionStore(): SessionStore {
  return createSessionStore(resolveBrowserStorage());
}
