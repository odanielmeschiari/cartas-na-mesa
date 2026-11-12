import { z } from 'zod';

// Identificadores são opacos na borda, mas nunca vazios (contrato §2).
export const roomCodeSchema = z.string().min(1);
export const matchIdSchema = z.string().min(1);
export const playerIdSchema = z.string().min(1);
export const cardIdSchema = z.string().min(1);
export const sessionTokenSchema = z.string().min(1);
export const gameIdSchema = z.string().min(1);

export const seatIndexSchema = z.number().int().nonnegative();
export const stateVersionSchema = z.number().int().nonnegative();

// O trim acontece antes dos limites, então "   " vira "" e é rejeitado.
export const nicknameSchema = z.string().trim().min(1).max(24);

// null representa o avatar padrão; a ausência do campo não é permitida.
export const avatarIdSchema = z.string().nullable();

export type RoomCode = z.infer<typeof roomCodeSchema>;
export type MatchId = z.infer<typeof matchIdSchema>;
export type PlayerId = z.infer<typeof playerIdSchema>;
export type CardId = z.infer<typeof cardIdSchema>;
export type SessionToken = z.infer<typeof sessionTokenSchema>;
export type GameId = z.infer<typeof gameIdSchema>;
export type SeatIndex = z.infer<typeof seatIndexSchema>;
export type StateVersion = z.infer<typeof stateVersionSchema>;
export type Nickname = z.infer<typeof nicknameSchema>;
export type AvatarId = z.infer<typeof avatarIdSchema>;
