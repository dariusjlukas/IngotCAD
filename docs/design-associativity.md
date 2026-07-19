# Design: Full face associativity (parametric regeneration)

Status: **Stage A implemented** (2026-07-10) — see §7 for what shipped and the
deliberate cuts. Stages B (originalID face identity) and C (badges/prefs)
remain as designed. Originally written 2026-07-07 against schema v2.

## 1. Problem

Ingot already lets you sketch on a face or derive a construction plane from one,
but the attachment is a **snapshot**: the dependent stores a static
`SketchPlane` (world frame) plus a `FaceRef` — the source face's plane equation
in the source node's _local_ space — used only for stale **detection**
([faceRef.ts](../src/document/faceRef.ts), watched by
[FaceRefMonitor.tsx](../src/document/FaceRefMonitor.tsx)). When the source
face moves, the user gets a toast and an explicit, undoable **Rebind**.

That "associativity lite" model is honest and predictable, but it breaks the
core promise of parametric editing: _change the bracket's thickness and the
holes sketched on its face move with it_. Today they don't — every upstream
edit demands a manual rebind of every dependent, and a rebind chain (plane on
face → sketch on plane → extrusion → another sketch on _that_) must be walked
by hand, outside-in.

**Goal:** dependents follow their source faces automatically, without breaking
the architecture's four load-bearing invariants:

1. The document is plain serializable data; geometry is derived.
2. All edits go through `mutate` (one undo step per user action).
3. The engine (`src/engine/`) is the only Manifold owner; it receives plain data.
4. Geometry recompute is keyed by structural hash ([hash.ts](../src/engine/hash.ts));
   equal hash ⇒ identical geometry.

## 2. Why this is the hardest feature in the codebase

- **Cross-tree dependencies.** Today a node's geometry is a pure function of
  its own subtree — that's what makes `localHash` a sound cache key. A
  face-attached extrusion's _placement_ depends on another root's geometry.
  Naively recomputing placement without folding the dependency into the cache
  key = silently stale geometry, the worst failure class in the app.
- **Cycles.** Sketch on face of A, extrude to B, boolean B into A's group —
  now A's geometry depends on B's placement depends on A's geometry. The
  system must detect and refuse cycles at attach time _and_ at resolve time
  (edits can create cycles that were legal at attach time).
- **Face identity.** Plane-equation matching (`matchFaceRef`) is a heuristic:
  it correctly refuses ambiguity (two parallel candidate faces → `missing`,
  never a silent wrong bind), but it can't track a face through a topology
  change that moves it beyond the `MOVED_*` tolerances, and it identifies the
  face of the _composed_ node, so editing an unrelated sibling inside the same
  group can shift offsets and confuse matching.
- **Undo semantics.** If upstream edits auto-rewrite dependents' stored
  transforms, either every edit becomes a multi-node undo diff (noisy, and
  undo/redo of the upstream edit must replay the rewrite) or undo history
  corrupts. The only clean answer: **derived placement must not live in the
  document** — same rule as derived geometry.

## 3. Design overview

Three stages, each shippable alone. The guiding move: promote the `FaceRef`
from _detection key_ to _authority_, and demote the stored snapshot from
_authority_ to _fallback cache_ — mirroring how the doc/geometry split already
works.

```
Stage A  Resolver pass: placement becomes derived (plane-match identity, as today)
Stage B  Face identity v2: Manifold originalID provenance (leaf-frame FaceRefs)
Stage C  UX: dependency badges, auto/manual regen preference, break-link
```

### 3.1 Stage A — the resolver pass

A new pure module `src/document/resolve.ts`:

```ts
/** Derived world frames for face-attached dependents, keyed by dependent id. */
export interface ResolvedFrames {
  planes: Record<string, SketchPlane> // construction planes (kind:'face')
  nodePlacements: Record<NodeId, Transform> // face-attached extrusions/revolutions
  status: Record<string, FaceRefStatus> // ok | moved | missing per dependent
}

export function resolveDerived(doc: CadDocument, meshes: MeshLookup): ResolvedFrames
```

- Build the dependency graph: edges `ref.nodeId → dependent` from
  `collectDependents` (same walk `FaceRefMonitor` does today). Topologically
  sort; on a cycle, mark every dependent on the cycle `missing` (falls back to
  its snapshot) and surface one toast — never throw, never half-apply.
- For each dependent in topo order: re-match the face on the source's current
  mesh (`planarFaceGroups` + `matchFaceRef` — Stage A reuses today's matcher
  unchanged), compose with the source's current world matrix, and emit the
  resolved frame. `missing`/ambiguous → emit the stored snapshot (frozen
  last-good) and a stale status, which is exactly today's behavior — **the
  current system is the degraded mode of the new one.** That's what makes this
  incremental rather than a rewrite.
- The sketch's 2D content is re-anchored by mapping the stored plane's frame to
  the resolved frame (rigid transform between the two `SketchPlane` bases), so
  the profile doesn't slide in-plane when the face translates in its own plane
  (in-plane sliding is unobservable from the plane equation alone; the frame
  transport must come from the source's world-matrix delta, not from the
  plane equation).

**Where it runs.** On the main thread, in the same derived-data path that
feeds the engine ([useDerivedGeometry.ts](../src/viewport/useDerivedGeometry.ts)),
_before_ any engine request. `FaceRefMonitor`'s debounced check becomes a thin
consumer of `ResolvedFrames.status` instead of doing its own matching.

**Rendering.** A face-attached extrusion is rendered with the _resolved_
transform instead of `node.transform` (one branch in
[NodeView.tsx](../src/viewport/NodeView.tsx)); the stored transform remains
the serialized fallback and is refreshed only by explicit user actions
(rebind, detach, or editing the sketch), which are ordinary undoable mutations.

**Caching — the critical part.** Resolution needs the _source's evaluated
mesh_, which needs the engine. To avoid a resolver↔engine cycle and keep
invariant 3, resolution consumes the **already-computed root meshes** the
viewport holds (the `meshRegistry` / derived-geometry cache). Ordering:

1. Engine evaluates all _source_ roots (no face-attached placement affects a
   source's own local geometry — placement is a rigid transform, and
   `evaluateLocal` never sees it).
2. Resolver computes frames from those meshes.
3. Dependent roots whose _parent-visible_ geometry depends on placement (i.e.
   a face-attached node nested inside a group/boolean) are re-evaluated with
   the resolved transform **injected into the eval request**, not read from
   the doc. The cache key for such a parent becomes
   `fullHash(child) ⊕ quantized(resolvedTransform)` — the existing `fullHash`
   already quantizes transforms to 1e-6 ([hash.ts](../src/engine/hash.ts) `t()`);
   reuse that. Equal hash ⇒ identical geometry stays true.
   Concretely: the worker protocol's evaluate request grows an optional
   `overrides: Record<NodeId, Transform>` field, applied where `evaluate()`
   reads `doc.nodes[id].transform`. The engine stays a pure function of its
   inputs; the inputs just gained a field.
4. Top-level face-attached roots need no re-evaluation at all — their local
   geometry is unchanged; only the three.js matrix moves (free, same as the
   root-transform rule today).

**Cost.** Step 1→2→3 introduces one extra evaluation _wave_ only for documents
that nest face-attached nodes inside containers — rare in practice (attach
targets are usually top-level). The common case (top-level dependents) costs
one plane-match per dependent per upstream change, which `FaceRefMonitor`
already pays today.

**Undo.** Upstream edits no longer touch dependents in the doc → undo stays
one-node, one-step. Undoing the upstream edit re-resolves automatically.
Nothing about `mutate`/`past`/`future` changes.

### 3.2 Stage B — face identity v2 (Manifold provenance)

Plane-equation matching fails when a face moves far or two faces are parallel
and close. Manifold 3.5 (bundled: `manifold-3d@3.5.0`) exposes provenance:
`Manifold.reserveIDs(n)`, `asOriginal()`, `originalID()`, and per-triangle
`Mesh.runOriginalID` — face runs in an evaluated mesh carry the ID of the
source solid they came from, through booleans.

- At leaf build time ([evaluate.ts](../src/engine/evaluate.ts)
  `buildPrimitive`), stamp each primitive with a reserved ID and record
  `leafNodeId → originalID` for the evaluation. IDs are per-evaluation
  transients; the _document_ stores only `leafNodeId` (stable, serializable).
- `FaceRef` v2 (schema v3, with migration):

  ```ts
  interface FaceRef2 {
    leafId: NodeId // the primitive the face physically comes from
    normal: Vec3 // face plane in the LEAF's local space
    offset: number
  }
  ```

  Leaf-local is far more stable than composed-node-local: editing a sibling in
  the group no longer perturbs the reference, and a box face keeps its plane
  under every param edit except ones that actually move that face.

- Matching ladder (strongest first), replacing `matchFaceRef` internals but
  keeping its `ok | moved | missing` contract and ambiguity-refusal rule:
  1. Face runs with the leaf's `originalID` whose leaf-local plane matches
     exactly → `ok`.
  2. Same-ID runs, plane within loose tolerance, unique best → `moved`.
  3. No same-ID runs (leaf deleted / face consumed by a boolean) → fall back
     to today's whole-mesh plane match → `moved`/`missing`.
- The engine already returns plain meshes; it additionally returns
  `runOriginalID` + `runIndex` slices (plain typed arrays — invariant 3 holds).
  `planarFaceGroups` gains an optional per-triangle ID input so groups carry
  their provenance.

Stage B is pure identity-quality: no new data flow, no new cache semantics —
it swaps the matcher under the Stage A resolver. Ship A without B; B makes it
trustworthy at scale.

### 3.3 Stage C — regeneration UX

- **Badges** in the outliner: linked (follows face), stale-frozen (source
  missing/ambiguous — using last-good snapshot), with "Re-link…" / "Break
  link" (bake current resolved frame into `node.transform`, drop the ref) as
  undoable actions.
- **Preference** `regen: 'auto' | 'manual'` in prefs: `manual` keeps today's
  toast+rebind behavior for users who dislike things moving on their own.
  (Auto is the point of the feature, but frozen-until-clicked is a legitimate
  CAD stance and costs one branch in the resolver's consumer.)
- Attach-time cycle refusal: picking a face whose source subtree contains the
  node being attached (or any of its dependents, transitively) greys the face
  in the picker with a "would create a circular reference" hint.

## 4. What NOT to do

- **Don't store resolved frames in the document** — undo spam plus
  divergence; it's derived data, same as triangles.
- **Don't let the engine call the resolver** — keep evaluation a pure function
  of `(doc, overrides)`; the resolver composes _outside_.
- **Don't auto-bind ambiguous faces.** `matchFaceRef`'s refusal rule (two
  plausible candidates ⇒ `missing`) is the best decision in the current
  system; silent wrong binds are worse than stale ones. Keep it through every
  stage.
- **Don't attempt curved-face attachment** (cylinder barrels etc.). Planar
  faces only; curved support changes the sketch-plane model fundamentally and
  is out of scope.
- **Don't build a general feature-history/regeneration tree.** The CSG node
  tree _is_ the model; this design adds one derived pass over it, not a
  parallel history graph. (See [roadmap.md](roadmap.md) §2 for why Ingot
  should stay direct-modeling-first.)

## 5. Testing strategy

All layers below the viewport are plain data → unit-testable in vitest:

- **Resolver:** box + sketch-on-top-face fixture; grow the box height by Δ;
  assert the resolved frame translates by exactly Δ·n̂ (and the extrusion's
  profile is unchanged). Same for rotation of the source, nested sources
  (plane-on-face-of-extrusion-on-face), and in-plane source translation (the
  frame-transport case plane equations can't see).
- **Cycles:** attach A→B then mutate to close the loop B→A; assert both
  resolve to frozen snapshots + `missing` status, document unchanged, no throw.
- **Cache soundness (the stale-geometry guard):** evaluate parent containing a
  face-attached child, move the source, re-resolve, re-evaluate; assert the
  request hash changed. Property-style: random source edits; hash unchanged ⇔
  resolved frames unchanged.
- **Stage B provenance:** union two boxes, assert `runOriginalID` maps each
  surviving face to the right leaf; consume a face entirely with a subtract
  and assert the ladder falls through to `missing`, not a wrong bind.
- **Migration:** v2 documents load with `FaceRef` composed-node refs upgraded
  lazily (keep matching against the composed node until the user re-picks;
  don't guess leaf attribution at load time — it requires evaluation and can
  be wrong).

## 6. Effort & sequencing

| Stage | Scope                                                                                          | Estimate             |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------- |
| A     | resolver, transform override in worker protocol, NodeView branch, FaceRefMonitor rebase, tests | 3–5 focused sessions |
| B     | leaf ID stamping, run-ID plumb-through, matcher ladder, schema v3 migration, tests             | 2–3 sessions         |
| C     | badges, prefs, cycle-aware picker                                                              | 1–2 sessions         |

Risks worth respecting: the Stage A cache-key change touches the app's
performance spine — land it behind exhaustive hash tests before wiring the
viewport; and the frame-transport math (in-plane anchoring) is the subtlest
piece — write its tests first.

## 7. Stage A as shipped (2026-07-10)

Implemented in [resolve.ts](../src/document/resolve.ts) (pure resolver + tests),
[resolvedStore.ts](../src/document/resolvedStore.ts) (transient frames),
[FaceRefMonitor.tsx](../src/document/FaceRefMonitor.tsx) (now resolver-driven),
plus wiring in NodeView / ConstructionPlanes / PlanePicker / the engine
protocol. Two refinements over the original design, and two deliberate cuts:

- **Delta composition instead of frame replacement.** The resolved placement is
  `T_resolved = Δ ∘ T_stored`, where Δ maps the stored snapshot plane to the
  re-matched plane. Nothing moved ⇒ Δ = identity ⇒ resolved === stored, and a
  user's manual gizmo offset survives because it lives inside `T_stored`.
- **Attach-time local frames.** `FaceRef` gained an optional `frame` (the
  attached plane in the source's LOCAL space, captured at pick time). This is
  what lets the resolver see in-plane source translation/rotation — invisible
  to the plane equation. Additive field, no schema bump; legacy refs resolve
  with equation-only transport (they can't follow in-plane motion — the §5
  limitation test pins this).
- **Re-anchor on explicit transform edits.** `setNodeTransform` on a following
  node refreshes the snapshot plane + faceRef in the same undo step; without
  this, a gizmo commit authored against the resolved placement would get the
  face delta applied twice on the next resolve.
- **Cut: only top-level dependents auto-follow.** Nested face-attached nodes
  (inside groups/booleans) resolve and surface status but keep their stored
  placement — the same override set drives rendering AND exports
  (`rootOverrides`), so what you see is always what you print. Extending
  overrides into `computeMesh` requires folding them into the cache key
  (fullHash ⊕ override) as designed in §3.1 — deferred until nesting proves
  common.
- **Cut: 'moved' no longer toasts.** Auto-following is visible on screen; the
  toast survives only for `missing` (frozen). The property editor's Rebind
  button now acts as an explicit "bake current placement into the document".
