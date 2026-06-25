export const VALID_ID = /^[A-Za-z0-9._-]+$/;

export function hasCycle(
  items: Array<{ id: string; dependencies?: string[] }>
): boolean {
  const dependencies = new Map(
    items.map((item) => [item.id, item.dependencies ?? []])
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return items.some((item) => visit(item.id));
}
