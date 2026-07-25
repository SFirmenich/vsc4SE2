export function eventServerConfigurationFromManifest(manifest: Record<string, unknown> | undefined) {
  const repository = manifest?.repository;
  if (!repository || typeof repository !== "object") {
    return null;
  }
  const eventServer = (repository as { eventServer?: unknown }).eventServer;
  if (!eventServer || typeof eventServer !== "object") {
    return null;
  }
  return eventServer as Record<string, unknown>;
}
