import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationFiles = readdirSync('supabase/migrations')
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();

describe('Supabase migration version ownership', () => {
  it('assigns every 14-digit migration version to exactly one file', () => {
    const byVersion = new Map();
    for (const file of migrationFiles) {
      const version = file.slice(0, 14);
      const owners = byVersion.get(version) ?? [];
      owners.push(file);
      byVersion.set(version, owners);
    }

    const collisions = [...byVersion.entries()]
      .filter(([, owners]) => owners.length !== 1)
      .map(([version, owners]) => `${version}: ${owners.join(', ')}`);

    expect(collisions, `duplicate Supabase migration versions:\n${collisions.join('\n')}`).toEqual([]);
  });
});