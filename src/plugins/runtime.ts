/** Stub for test setup; maintains active plugin registry for tests. */
let activeRegistry: unknown = null;

export function setActivePluginRegistry(registry: unknown): void {
  activeRegistry = registry;
}

export function getActivePluginRegistry(): unknown {
  return activeRegistry;
}
