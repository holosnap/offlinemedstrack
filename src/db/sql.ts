import type { SqlValue } from './types';

/** Builds `col = ?, col = ?` from the entries whose value is not `undefined`. */
export function buildSet(fields: Record<string, SqlValue | undefined>): {
  clause: string;
  params: SqlValue[];
} {
  const entries = Object.entries(fields).filter(
    (entry): entry is [string, SqlValue] => entry[1] !== undefined,
  );
  return {
    clause: entries.map(([column]) => `${column} = ?`).join(', '),
    params: entries.map(([, value]) => value),
  };
}

export const toBool = (value: boolean | undefined): number | undefined =>
  value === undefined ? undefined : value ? 1 : 0;
