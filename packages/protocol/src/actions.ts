import { z } from 'zod';

import { cardIdSchema } from './scalars';

// Strict para que campos desconhecidos, como um playerId injetado, falhem na validação.
export const actionPayloadSchema = z.strictObject({
  type: z.literal('play_card'),
  cardId: cardIdSchema,
});

export type ActionPayload = z.infer<typeof actionPayloadSchema>;
