import type { ThemeDef } from '../theme/types';

export interface PathNode {
  id: string;
  gx: number;
  gy: number;
}

/**
 * Graf waypointów motywu (drzwi budynków + skrzyżowania) i Dijkstra.
 * Jednostki chodzą po "drogach" — wygląda naturalnie i nie wymaga
 * pełnego A* po siatce przy ambientowej skali 5-20 jednostek.
 */
export class WaypointGraph {
  private nodes = new Map<string, PathNode>();
  private adjacency = new Map<string, { to: string; cost: number }[]>();

  constructor(theme: ThemeDef) {
    for (const building of theme.buildings) {
      this.addNode({ id: `door:${building.id}`, gx: building.door.gx, gy: building.door.gy });
    }
    for (const node of theme.crossroads) this.addNode(node);
    for (const [a, b] of theme.edges) this.addEdge(a, b);
  }

  private addNode(node: PathNode): void {
    this.nodes.set(node.id, node);
    this.adjacency.set(node.id, []);
  }

  private addEdge(a: string, b: string): void {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) throw new Error(`Krawędź do nieznanego węzła: ${a} - ${b}`);
    const cost = Math.hypot(na.gx - nb.gx, na.gy - nb.gy);
    this.adjacency.get(a)!.push({ to: b, cost });
    this.adjacency.get(b)!.push({ to: a, cost });
  }

  node(id: string): PathNode | undefined {
    return this.nodes.get(id);
  }

  /** Najbliższy węzeł grafu dla dowolnej pozycji na siatce. */
  nearest(gx: number, gy: number): PathNode {
    let best: PathNode | undefined;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const dist = Math.hypot(node.gx - gx, node.gy - gy);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best!;
  }

  /** Dijkstra: lista węzłów od startu do celu (włącznie). */
  route(fromId: string, toId: string): PathNode[] {
    if (fromId === toId) return [this.nodes.get(fromId)!];
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const open = new Set(this.nodes.keys());
    dist.set(fromId, 0);

    while (open.size > 0) {
      let current: string | undefined;
      let currentDist = Infinity;
      for (const id of open) {
        const d = dist.get(id) ?? Infinity;
        if (d < currentDist) {
          currentDist = d;
          current = id;
        }
      }
      if (!current || current === toId || currentDist === Infinity) break;
      open.delete(current);

      for (const edge of this.adjacency.get(current) ?? []) {
        const candidate = currentDist + edge.cost;
        if (candidate < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, candidate);
          prev.set(edge.to, current);
        }
      }
    }

    if (!prev.has(toId)) return [this.nodes.get(toId)!].filter(Boolean);
    const path: PathNode[] = [];
    let cursor: string | undefined = toId;
    while (cursor) {
      path.unshift(this.nodes.get(cursor)!);
      cursor = prev.get(cursor);
    }
    return path;
  }
}
