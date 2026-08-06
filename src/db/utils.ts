import { randomUUID } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as T;
}
