// Infraestrutura de aleatoriedade do servidor.
//
// Regra 11 do AGENTS.md: em produção a aleatoriedade vem de um CSPRNG
// imprevisível e nos testes de uma fonte injetada e determinística. Este módulo
// é a única porta de entrada para aleatoriedade no servidor; `Math.random`,
// `Date.now` e afins não aparecem em nenhum caminho daqui.
//
// A seed da partida NÃO vive aqui: ela é responsabilidade da sala (§4 de
// docs/architecture/0002-spike-mecanismo-tempo-real.md).

/**
 * Fonte de bytes aleatórios, injetável para tornar os testes determinísticos.
 *
 * Deve devolver **exatamente** `length` bytes. A fonte padrão é o CSPRNG da
 * plataforma (`cryptoRandomBytes`); a escolha da fonte é sempre do servidor —
 * nenhum valor vindo de mensagem do cliente pode substituí-la.
 */
export type RandomSource = (length: number) => Uint8Array;

/** Maior número de bytes aceitos por chamada de `crypto.getRandomValues` (Web Crypto). */
const MAX_RANDOM_BYTES_PER_CALL = 65_536;

/**
 * Alfabeto do código de sala: 32 símbolos sem os caracteres que se confundem
 * entre si (`0`/`O` e `1`/`I`/`L`), para o código poder ser ditado sem
 * ambiguidade.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ALPHABET_SIZE = ROOM_CODE_ALPHABET.length;

/** Comprimento padrão do código de sala (32^6 ≈ 2^30 de espaço de busca). */
export const DEFAULT_ROOM_CODE_LENGTH = 6;

/**
 * Faixa aceita para o comprimento do código de sala: de 1 a 12 caracteres.
 * Abaixo de 1 não existe código; acima de 12 o código fica impraticável de
 * ler e ditar em voz alta, que é justamente o propósito do código curto.
 */
export const MIN_ROOM_CODE_LENGTH = 1;
export const MAX_ROOM_CODE_LENGTH = 12;

/** Bytes do token de sessão: 32 bytes = 256 bits de entropia. */
export const SESSION_TOKEN_BYTES = 32;

/**
 * Janela de aceitação do byte sorteado: o maior múltiplo do tamanho do
 * alfabeto estritamente menor que 256 (7 × 32 = 224).
 *
 * Sorteio por rejeição: bytes 224–255 são descartados e o byte é sorteado de
 * novo. Como 224 é múltiplo de 32, cada uma das 32 classes de resto perde
 * exatamente um representante, então a distribuição dos caracteres continua
 * uniforme — sem o viés que apareceria se o byte fosse reduzido por módulo sem
 * ajuste da faixa. A janela é deliberadamente menor que os 256 disponíveis
 * (que também seriam múltiplo de 32) para que o caminho de rejeição exista de
 * fato e possa ser verificado em teste.
 */
const ROOM_CODE_BYTE_LIMIT = 224;

/**
 * Preenche um buffer com bytes do CSPRNG da plataforma (Node 22 expõe `crypto`
 * global). Falha de forma explícita para comprimento inválido ou acima do
 * limite por chamada do Web Crypto, em vez de devolver bytes previsíveis.
 */
export function cryptoRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(
      `cryptoRandomBytes: length deve ser um inteiro >= 0 (recebido: ${String(length)}).`,
    );
  }
  if (length > MAX_RANDOM_BYTES_PER_CALL) {
    throw new RangeError(
      `cryptoRandomBytes: length não pode ultrapassar ${MAX_RANDOM_BYTES_PER_CALL} bytes por chamada (recebido: ${length}).`,
    );
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Lê `length` bytes da fonte, exigindo que a fonte entregue a quantidade pedida. */
function readBytes(source: RandomSource, length: number): Uint8Array {
  const bytes = source(length);
  if (bytes.length !== length) {
    throw new Error(
      `A fonte de aleatoriedade devolveu ${bytes.length} bytes; eram esperados ${length}.`,
    );
  }
  return bytes;
}

/**
 * Inteiro de 32 bits sem sinal, montado com 4 bytes big-endian.
 * A fonte padrão é o CSPRNG da plataforma; a fonte só é injetada por teste.
 */
export function randomUint32(source: RandomSource = cryptoRandomBytes): number {
  const bytes = readBytes(source, 4);
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error('A fonte de aleatoriedade devolveu bytes insuficientes para formar um uint32.');
  }
  return b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3;
}

/** Sorteia o índice do próximo caractere do alfabeto, descartando bytes fora da janela. */
function nextAlphabetIndex(source: RandomSource): number {
  for (;;) {
    const bytes = readBytes(source, 1);
    const byte = bytes[0];
    if (byte === undefined) {
      throw new Error('A fonte de aleatoriedade devolveu bytes insuficientes.');
    }
    if (byte < ROOM_CODE_BYTE_LIMIT) {
      return byte % ALPHABET_SIZE;
    }
  }
}

/**
 * Código de sala: `length` caracteres do alfabeto sem ambiguidade visual,
 * sorteados por rejeição sobre o CSPRNG. O comprimento padrão é 6 e a faixa
 * aceita é de 1 a 12 (ver `MIN_ROOM_CODE_LENGTH`/`MAX_ROOM_CODE_LENGTH`).
 */
export function randomRoomCode(
  length: number = DEFAULT_ROOM_CODE_LENGTH,
  source: RandomSource = cryptoRandomBytes,
): string {
  if (!Number.isInteger(length) || length < MIN_ROOM_CODE_LENGTH || length > MAX_ROOM_CODE_LENGTH) {
    throw new RangeError(
      `randomRoomCode: length deve ser um inteiro entre ${MIN_ROOM_CODE_LENGTH} e ${MAX_ROOM_CODE_LENGTH} (recebido: ${String(length)}).`,
    );
  }
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += ROOM_CODE_ALPHABET.charAt(nextAlphabetIndex(source));
  }
  return code;
}

/**
 * Token de sessão opaco, com 256 bits de entropia, codificado em base64url
 * (seguro para URL e para transporte JSON).
 */
export function randomSessionToken(source: RandomSource = cryptoRandomBytes): string {
  const bytes = readBytes(source, SESSION_TOKEN_BYTES);
  return Buffer.from(bytes).toString('base64url');
}
