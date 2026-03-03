/** Stub for test setup; creates an immutable plugin registry from entries. */
export type RegistryEntry = {
  pluginId: string;
  plugin: unknown;
  source: string;
};

export function createTestRegistry(entries: RegistryEntry[]): unknown {
  return Object.freeze({ entries, plugins: new Map(entries.map((e) => [e.pluginId, e.plugin])) });
}
