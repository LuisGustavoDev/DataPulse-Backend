import { v7 } from 'uuid';

/**
 * Gera um UUIDv7 (spec §0). Diferente do v4, que é todo aleatório, o v7 começa
 * pelo horário: IDs novos ficam em ordem, o que mantém os índices do banco compactos.
 */
export function newId(): string {
  return v7();
}