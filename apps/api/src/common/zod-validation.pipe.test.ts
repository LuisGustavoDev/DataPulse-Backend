import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const pipe = new ZodValidationPipe(z.object({ email: z.email() }));

describe('ZodValidationPipe', () => {
  it('entrega os dados válidos e remove campos extras', () => {
    expect(pipe.transform({ email: 'ana@acme.com', role: 'admin' })).toEqual({ email: 'ana@acme.com' });
  });

  it('responde 400 com os campos inválidos', () => {
    try {
      pipe.transform({ email: 'não-é-email' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'email' }],
      });
    }
  });
});