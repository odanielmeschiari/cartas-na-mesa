import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_URL, resolveServerUrl } from './server-url';

describe('resolveServerUrl', () => {
  it('usa a variável de ambiente quando ela existe', () => {
    expect(
      resolveServerUrl({
        envUrl: 'ws://servidor.exemplo:4000',
        hostname: 'localhost',
        protocol: 'http:',
      }),
    ).toBe('ws://servidor.exemplo:4000');
  });

  it('ignora a variável de ambiente vazia ou só com espaços', () => {
    expect(resolveServerUrl({ envUrl: '   ', hostname: 'localhost', protocol: 'http:' })).toBe(
      'ws://localhost:3001',
    );
  });

  it('monta a URL a partir do hostname da página', () => {
    expect(resolveServerUrl({ envUrl: undefined, hostname: 'localhost', protocol: 'http:' })).toBe(
      'ws://localhost:3001',
    );
  });

  it('acompanha o hostname da máquina em que a página foi aberta', () => {
    expect(
      resolveServerUrl({ envUrl: undefined, hostname: '192.168.0.10', protocol: 'http:' }),
    ).toBe('ws://192.168.0.10:3001');
  });

  it('usa wss quando a página é servida por TLS', () => {
    expect(
      resolveServerUrl({ envUrl: undefined, hostname: 'jogo.exemplo', protocol: 'https:' }),
    ).toBe('wss://jogo.exemplo:3001');
  });

  it('usa ws para qualquer outro protocolo de página', () => {
    expect(
      resolveServerUrl({ envUrl: undefined, hostname: 'jogo.exemplo', protocol: 'http:' }),
    ).toBe('ws://jogo.exemplo:3001');
  });

  it('cai no padrão quando não há navegador nem variável de ambiente', () => {
    expect(resolveServerUrl({ envUrl: undefined, hostname: null, protocol: undefined })).toBe(
      DEFAULT_SERVER_URL,
    );
  });

  it('nunca devolve URL vazia', () => {
    const resolved = resolveServerUrl({ envUrl: '', hostname: '', protocol: '' });

    expect(resolved.length).toBeGreaterThan(0);
  });
});
