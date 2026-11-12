/**
 * Resolução da URL do servidor Colyseus.
 *
 * **Decisão:** a URL vem de `VITE_SERVER_URL` quando a variável de ambiente
 * existe; caso contrário, é montada a partir de `window.location.hostname`,
 * na porta 3001. O hostname da página é o da máquina em que o navegador foi
 * aberto, então o cliente fala com o servidor da **mesma máquina** — o que
 * funciona tanto em `localhost` quanto em um endereço de rede local, sem
 * duplicar a lista de endereços. Sem navegador nenhum (teste, renderização no
 * servidor), o padrão é `ws://localhost:3001`.
 *
 * O esquema acompanha o da página: `https:` vira `wss:`, para não cair em
 * conteúdo misto quando o cliente for servido por TLS.
 *
 * A URL é **opaca** para o cliente: ele nunca a interpreta, só a entrega ao
 * SDK do Colyseus.
 */

/** Porta padrão do servidor do spike. */
export const DEFAULT_SERVER_PORT = 3001;

/** URL usada quando não há navegador e nenhuma variável de ambiente. */
export const DEFAULT_SERVER_URL = `ws://localhost:${DEFAULT_SERVER_PORT}`;

/** Entradas da resolução da URL do servidor. */
export interface ServerUrlOptions {
  /** Conteúdo de `VITE_SERVER_URL`, quando definido. */
  readonly envUrl: string | undefined;
  /** `window.location.hostname`, quando há navegador. */
  readonly hostname: string | null;
  /** `window.location.protocol`, quando há navegador. */
  readonly protocol: string | undefined;
}

/**
 * Resolve a URL do servidor Colyseus.
 *
 * A função é total: nunca lança e sempre devolve uma URL não vazia.
 */
export function resolveServerUrl(options: ServerUrlOptions): string {
  const envUrl = options.envUrl?.trim() ?? '';
  if (envUrl.length > 0) {
    return envUrl;
  }

  const hostname = options.hostname?.trim() ?? '';
  if (hostname.length > 0) {
    const scheme = options.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${hostname}:${DEFAULT_SERVER_PORT}`;
  }

  return DEFAULT_SERVER_URL;
}
