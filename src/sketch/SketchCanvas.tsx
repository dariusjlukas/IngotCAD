/**
 * The 2D sketch drawing surface (SVG), shown in the viewport area while
 * sketching. Tools/constraints/properties live in the app header and side
 * panels (SketchPanels.tsx); this component only owns the canvas and its
 * transient interaction state.
 *
 * Select mode is the absence of a tool (`tool === null`). Escape clears any
 * in-progress action and returns to Select — it never exits the sketch (only
 * the Cancel button does). Dimensions are placed by following the cursor, then
 * clicking, which opens an inline value editor.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Vec2 } from '../document/types'
import { useSketchStore } from './sketchStore'
import type { Ref } from './sketchStore'
import type { Constraint, PointId, ShapeId } from './model'
import { canTreatCorner, cornerNeighbors, loopOutline, loopSegments } from './model'
import {
  arcFromSagitta,
  arcPoints,
  cornerPoints,
  distance,
  distToArc,
  maxCornerSize,
  niceStep,
  pointInPolygon,
} from './geometry'
import { worldToLocalMatrix } from './plane'
import { useCadStore } from '../document/store'
import { engine } from '../engine/engine'

const CLOSE_DIST = 4
const pt = (x: number, y: number) => `${x},${-y}`
const path = (pts: Vec2[]) => 'M ' + pts.map(([x, y]) => pt(x, y)).join(' L ') + ' Z'
const r1 = (n: number) => Math.round(n * 100) / 100

function normal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [-dy / len, dx / len]
}
function signedOffset(p: Vec2, a: Vec2, b: Vec2): number {
  const n = normal(a, b)
  return (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]
}
function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function SketchCanvas() {
  const tool = useSketchStore((s) => s.tool)
  const data = useSketchStore((s) => s.data)
  const selection = useSketchStore((s) => s.selection)
  const view = useSketchStore((s) => s.view)
  const outputMode = useSketchStore((s) => s.outputMode)
  const plane = useSketchStore((s) => s.plane)
  const editingNodeId = useSketchStore((s) => s.editingNodeId)
  const st = useSketchStore
  // One polygon-group per scene geometry that meets the plane (section outlines).
  const [projection, setProjection] = useState<Vec2[][][]>([])

  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [drag, setDrag] = useState<{ start: Vec2; current: Vec2 } | null>(null)
  // Line-tool draft vertices; `coincident` ties one onto an existing point (merge).
  const [lineDraft, setLineDraft] = useState<{ pos: Vec2; coincident?: PointId }[]>([])
  const [snapPoint, setSnapPoint] = useState<PointId | null>(null)
  // Projection outline the Project tool would include if clicked (index into `projection`).
  const [projHover, setProjHover] = useState<number | null>(null)
  const [dimA, setDimA] = useState<PointId | null>(null)
  const [placing, setPlacing] = useState<{ a: PointId; b: PointId } | null>(null)
  // Radius dimension being placed (leader follows the cursor angle).
  const [placingRadius, setPlacingRadius] = useState<{
    shape?: ShapeId
    c: PointId
    a?: PointId
    b?: PointId
  } | null>(null)
  // Angle dimension being placed (dim arc follows the cursor distance).
  const [placingAngle, setPlacingAngle] = useState<{
    a: PointId
    b: PointId
    c: PointId
    d: PointId
  } | null>(null)
  // Arc tool: bowing the loop segment a→b (loop order) by the dragged sagitta.
  const [arcDrag, setArcDrag] = useState<{ a: PointId; b: PointId; sagitta: number } | null>(null)
  // Fillet/chamfer drag: the corner being sized and its (cyclic) neighbours.
  const [cornerDrag, setCornerDrag] = useState<{
    pid: PointId
    corner: Vec2
    prev: Vec2
    next: Vec2
    size: number
  } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  // Container aspect ratio (w/h). The viewBox is square, but the SVG fills a
  // wider-than-tall area with preserveAspectRatio="meet", so the visible model
  // range is wider than view.size. We track this to extend the grid to the edges.
  const [aspect, setAspect] = useState(1)
  const panRef = useRef<{ sx: number; sy: number; cx0: number; cy0: number; scale: number } | null>(
    null,
  )
  const moveRef = useRef<PointId | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const pos = (id: PointId): Vec2 => {
    const p = data.points[id]
    return p ? [p.x, p.y] : [0, 0]
  }
  // Loop segments in LOOP ORDER (a = start), carrying the segment's arc if any.
  const segments = useMemo(() => {
    const segs: { a: PointId; b: PointId; arc?: { center: PointId; ccw: boolean } }[] = []
    for (const s of data.shapes)
      if (s.kind === 'loop')
        for (const [a, b] of loopSegments(s.pts)) {
          const arc = s.arcs?.[a]
          segs.push(arc ? { a, b, arc: { center: arc.center, ccw: arc.ccw } } : { a, b })
        }
    return segs
  }, [data.shapes])

  const toModelRaw = (cx: number, cy: number): Vec2 => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse())
    return [p.x, -p.y]
  }
  const toModel = (cx: number, cy: number): Vec2 => {
    const [x, y] = toModelRaw(cx, cy)
    return [Math.round(x), Math.round(y)]
  }
  const screenPos = (mx: number, my: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const p = new DOMPoint(mx, -my).matrixTransform(ctm)
    const rect = svg.getBoundingClientRect()
    return { x: p.x - rect.left, y: p.y - rect.top }
  }

  const pointHitR = view.size * 0.02
  const segHitD = view.size * 0.012
  const defaultOff = view.size * 0.06
  const fontSize = view.size * 0.03

  const hitPoint = (p: Vec2): PointId | null => {
    let best: PointId | null = null
    let bestD = pointHitR
    for (const id of Object.keys(data.points)) {
      const d = distance(p, pos(id))
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }
  const hitSegment = (p: Vec2): (typeof segments)[number] | null => {
    let best: (typeof segments)[number] | null = null
    let bestD = segHitD
    for (const s of segments) {
      const d =
        s.arc && data.points[s.arc.center]
          ? distToArc(p, pos(s.arc.center), pos(s.a), pos(s.b), s.arc.ccw)
          : distToSeg(p, pos(s.a), pos(s.b))
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }
  const hitCircle = (p: Vec2): string | null => {
    for (let i = data.shapes.length - 1; i >= 0; i--) {
      const s = data.shapes[i]
      if (s.kind === 'circle' && distance(p, pos(s.c)) <= s.r + segHitD) return s.id
    }
    return null
  }
  // --- dimension geometry helpers (shared by render, hit-test, and inline edit) ---

  const radiusInfo = (
    c: Extract<Constraint, { kind: 'radius' }>,
  ): { center: Vec2; r: number } | null => {
    const ctr = data.points[c.c]
    if (!ctr) return null
    if (c.shape) {
      const s = data.shapes.find((x) => x.id === c.shape)
      if (!s || s.kind !== 'circle') return null
      return { center: [ctr.x, ctr.y], r: s.r }
    }
    if (c.a && c.b) {
      const a = data.points[c.a]
      const b = data.points[c.b]
      if (!a || !b) return null
      const r = (Math.hypot(a.x - ctr.x, a.y - ctr.y) + Math.hypot(b.x - ctr.x, b.y - ctr.y)) / 2
      return { center: [ctr.x, ctr.y], r }
    }
    return null
  }

  const radiusLabelPos = (c: Extract<Constraint, { kind: 'radius' }>): Vec2 | null => {
    const info = radiusInfo(c)
    if (!info) return null
    const ang = c.offset ?? Math.PI / 4
    const d = info.r + fontSize * 2
    return [info.center[0] + Math.cos(ang) * d, info.center[1] + Math.sin(ang) * d]
  }

  const angleInfo = (c: {
    a: PointId
    b: PointId
    c: PointId
    d: PointId
  }): { X: Vec2; t1: number; sweep: number } | null => {
    const A = pos(c.a)
    const B = pos(c.b)
    const C = pos(c.c)
    const D = pos(c.d)
    const d1: Vec2 = [B[0] - A[0], B[1] - A[1]]
    const d2: Vec2 = [D[0] - C[0], D[1] - C[1]]
    const denom = d1[0] * d2[1] - d1[1] * d2[0]
    if (Math.abs(denom) < 1e-9) return null // near-parallel: no intersection to dimension
    const t = ((C[0] - A[0]) * d2[1] - (C[1] - A[1]) * d2[0]) / denom
    const X: Vec2 = [A[0] + d1[0] * t, A[1] + d1[1] * t]
    const m1: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
    const m2: Vec2 = [(C[0] + D[0]) / 2, (C[1] + D[1]) / 2]
    const t1 = Math.atan2(m1[1] - X[1], m1[0] - X[0])
    const t2 = Math.atan2(m2[1] - X[1], m2[0] - X[0])
    let sweep = t2 - t1
    while (sweep > Math.PI) sweep -= 2 * Math.PI
    while (sweep <= -Math.PI) sweep += 2 * Math.PI
    return { X, t1, sweep }
  }

  const angleLabelPos = (c: Extract<Constraint, { kind: 'angle' }>): Vec2 | null => {
    const info = angleInfo(c)
    if (!info) return null
    const mid = info.t1 + info.sweep / 2
    const d = (c.offset ?? defaultOff) + fontSize * 0.9
    return [info.X[0] + Math.cos(mid) * d, info.X[1] + Math.sin(mid) * d]
  }

  const hitDimension = (p: Vec2): string | null => {
    for (const c of data.constraints) {
      if (c.kind === 'distance') {
        const a = pos(c.a)
        const b = pos(c.b)
        const n = normal(a, b)
        const off = c.offset ?? defaultOff
        const a2: Vec2 = [a[0] + n[0] * off, a[1] + n[1] * off]
        const b2: Vec2 = [b[0] + n[0] * off, b[1] + n[1] * off]
        if (distToSeg(p, a2, b2) < segHitD * 1.6) return c.id
      } else if (c.kind === 'radius') {
        const lp = radiusLabelPos(c)
        if (lp && distance(p, lp) < fontSize * 1.6) return c.id
      } else if (c.kind === 'angle') {
        const lp = angleLabelPos(c)
        if (lp && distance(p, lp) < fontSize * 1.6) return c.id
      }
    }
    return null
  }

  // Index of the section geometry under the cursor: inside one of its outline
  // polygons, or near an edge (so thin outlines stay grabbable). Topmost wins.
  const hitProjection = (p: Vec2): number | null => {
    for (let gi = projection.length - 1; gi >= 0; gi--) {
      for (const poly of projection[gi]) {
        if (poly.length < 3) continue
        if (pointInPolygon(poly, p)) return gi
        for (let j = 0; j < poly.length; j++) {
          if (distToSeg(p, poly[j], poly[(j + 1) % poly.length]) < segHitD) return gi
        }
      }
    }
    return null
  }

  const addToSelection = (ref: Ref, additive: boolean) => {
    if (!additive) return st.getState().select([ref])
    const cur = st.getState().selection
    const exists = cur.some((r) => sameRef(r, ref))
    st.getState().select(exists ? cur.filter((r) => !sameRef(r, ref)) : [...cur, ref])
  }

  const startEditing = (cid: string, value: number) => {
    setEditing(cid)
    setEditText(String(r1(value)))
  }

  // Focus the inline value editor once it appears. We must NOT use autoFocus:
  // it focuses during the placing press, and that press's mousedown on the SVG
  // then blurs it (firing onBlur → commit → unmount) before you can type.
  // Deferring to rAF focuses it cleanly after the click's default handling.
  useEffect(() => {
    if (!editing) return
    const raf = requestAnimationFrame(() => {
      editRef.current?.focus()
      editRef.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [editing])
  const commitEdit = () => {
    if (editing) {
      const v = parseFloat(editText)
      if (!Number.isNaN(v)) st.getState().setDimensionValue(editing, v)
    }
    setEditing(null)
  }

  // Section the existing scene with this plane for a reference underlay (only
  // geometry lying in the plane, not the silhouette of things in front/behind).
  // The cad document is static while sketching, so this runs once per plane.
  useEffect(() => {
    if (!plane) return
    const cadDoc = useCadStore.getState().doc
    // Exclude the node being edited so we don't see its old self underneath.
    const roots = cadDoc.rootIds.filter((id) => cadDoc.nodes[id]?.visible && id !== editingNodeId)
    if (roots.length === 0) {
      // Clear the async projection underlay when there's nothing to project.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjection([])
      return
    }
    let cancelled = false
    engine.projectScene(cadDoc, roots, worldToLocalMatrix(plane)).then((p) => {
      if (!cancelled) setProjection(p)
    })
    return () => {
      cancelled = true
    }
  }, [plane, editingNodeId])

  // track container aspect ratio so the grid can fill the full visible area
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const r = svg.getBoundingClientRect()
      if (r.height > 0) setAspect(r.width / r.height)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // wheel zoom toward cursor
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = toModelRaw(e.clientX, e.clientY)
      const v = st.getState().view
      const size = Math.min(4000, Math.max(5, v.size * (e.deltaY < 0 ? 0.9 : 1.1)))
      const k = size / v.size
      st.getState().setView({ cx: px + (v.cx - px) * k, cy: py + (v.cy - py) * k, size })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keyboard: Escape returns to Select (never exits); Enter commits; Backspace deletes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setLineDraft([])
        setDimA(null)
        setPlacing(null)
        setPlacingRadius(null)
        setPlacingAngle(null)
        setArcDrag(null)
        setCornerDrag(null)
        setEditing(null)
        st.getState().setTool(null)
      } else if (e.key === 'Enter') {
        // Enter only closes an in-progress line loop. It must NOT commit/extrude
        // the sketch — that's too easy to hit by accident; use the button.
        if (lineDraft.length >= 3) {
          e.preventDefault()
          st.getState().addLoop(lineDraft)
          setLineDraft([])
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        if (lineDraft.length) setLineDraft(lineDraft.slice(0, -1))
        else st.getState().deleteSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lineDraft, st])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      const ctm = svgRef.current?.getScreenCTM()
      if (ctm) {
        panRef.current = { sx: e.clientX, sy: e.clientY, cx0: view.cx, cy0: view.cy, scale: ctm.a }
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }
    if (e.button !== 0) return
    const raw = toModelRaw(e.clientX, e.clientY)
    const snap = toModel(e.clientX, e.clientY)
    const additive = e.shiftKey

    // Select mode (no tool)
    if (tool === null) {
      const hp = hitPoint(raw)
      if (hp) {
        addToSelection({ t: 'point', id: hp }, additive)
        moveRef.current = hp
        svgRef.current?.setPointerCapture(e.pointerId)
        return
      }
      const hd = hitDimension(raw)
      if (hd) return addToSelection({ t: 'constraint', id: hd }, additive)
      const hs = hitSegment(raw)
      if (hs) return addToSelection({ t: 'segment', a: hs.a, b: hs.b }, additive)
      const hc = hitCircle(raw)
      if (hc) return addToSelection({ t: 'circle', id: hc }, additive)
      if (!additive) st.getState().clearSelection()
      return
    }

    if (tool === 'line') {
      if (lineDraft.length >= 3 && distance(snap, lineDraft[0].pos) <= CLOSE_DIST) {
        st.getState().addLoop(lineDraft)
        setLineDraft([])
      } else {
        // Snap onto an existing point to merge (coincident) — lets loops join.
        const target = hitPoint(raw)
        if (target) setLineDraft([...lineDraft, { pos: pos(target), coincident: target }])
        else setLineDraft([...lineDraft, { pos: snap }])
      }
      return
    }

    if (tool === 'dimension') {
      if (placingRadius) {
        // Click places the leader at the cursor's angle from the center.
        const ctr = pos(placingRadius.c)
        const ang = Math.atan2(raw[1] - ctr[1], raw[0] - ctr[0])
        let value = 0
        if (placingRadius.shape) {
          const s = data.shapes.find((x) => x.id === placingRadius.shape)
          value = s && s.kind === 'circle' ? s.r : 0
        } else if (placingRadius.a && placingRadius.b) {
          value = (distance(pos(placingRadius.a), ctr) + distance(pos(placingRadius.b), ctr)) / 2
        }
        if (value <= 0) {
          setPlacingRadius(null)
          return
        }
        const cid = st.getState().addRadiusDim(placingRadius, value, ang)
        st.getState().select([{ t: 'constraint', id: cid }])
        setPlacingRadius(null)
        startEditing(cid, value)
        return
      }
      if (placingAngle) {
        const info = angleInfo(placingAngle)
        if (!info) {
          setPlacingAngle(null)
          return
        }
        const off = Math.max(fontSize, distance(raw, info.X))
        // Directed a→b to c→d angle, normalized into (0°, 180°] by flipping the
        // second segment when reflex (both readings of crossing lines are valid).
        const A = pos(placingAngle.a)
        const B = pos(placingAngle.b)
        const C = pos(placingAngle.c)
        const D = pos(placingAngle.d)
        const dd =
          ((Math.atan2(D[1] - C[1], D[0] - C[0]) - Math.atan2(B[1] - A[1], B[0] - A[0])) * 180) /
          Math.PI
        const norm = ((dd % 360) + 360) % 360
        const flip = norm > 180
        const value = flip ? norm - 180 : norm
        const cid = flip
          ? st
              .getState()
              .addAngleDim(
                placingAngle.a,
                placingAngle.b,
                placingAngle.d,
                placingAngle.c,
                value,
                off,
              )
          : st
              .getState()
              .addAngleDim(
                placingAngle.a,
                placingAngle.b,
                placingAngle.c,
                placingAngle.d,
                value,
                off,
              )
        st.getState().select([{ t: 'constraint', id: cid }])
        setPlacingAngle(null)
        startEditing(cid, value)
        return
      }
      if (placing) {
        // Clicking a second straight segment switches to an angle dimension.
        const hs2 = hitSegment(raw)
        if (
          hs2 &&
          !hs2.arc &&
          !(
            (hs2.a === placing.a && hs2.b === placing.b) ||
            (hs2.a === placing.b && hs2.b === placing.a)
          ) &&
          angleInfo({ a: placing.a, b: placing.b, c: hs2.a, d: hs2.b })
        ) {
          setPlacingAngle({ a: placing.a, b: placing.b, c: hs2.a, d: hs2.b })
          setPlacing(null)
          return
        }
        const off = Math.round(signedOffset(raw, pos(placing.a), pos(placing.b)))
        const value = distance(pos(placing.a), pos(placing.b))
        const cid = st.getState().addDistance(placing.a, placing.b, value, off)
        st.getState().select([{ t: 'constraint', id: cid }])
        setPlacing(null)
        startEditing(cid, value)
        return
      }
      const hp = hitPoint(raw)
      if (hp) {
        if (dimA == null) setDimA(hp)
        else if (hp !== dimA) {
          setPlacing({ a: dimA, b: hp })
          setDimA(null)
        }
        return
      }
      const hs = hitSegment(raw)
      if (hs) {
        // An arc segment gets a radius dimension; a straight one starts a
        // distance (or, with a second segment click, an angle).
        if (hs.arc) setPlacingRadius({ c: hs.arc.center, a: hs.a, b: hs.b })
        else setPlacing({ a: hs.a, b: hs.b })
        return
      }
      const hc = hitCircle(raw)
      if (hc) {
        const s = data.shapes.find((x) => x.id === hc)
        if (s && s.kind === 'circle') setPlacingRadius({ shape: s.id, c: s.c })
      }
      return
    }

    if (tool === 'arc') {
      const hs = hitSegment(raw)
      if (hs) {
        setArcDrag({ a: hs.a, b: hs.b, sagitta: signedOffset(raw, pos(hs.a), pos(hs.b)) })
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }

    if (tool === 'project') {
      const hi = hitProjection(raw)
      if (hi != null) st.getState().addProjectedLoops(projection[hi])
      return
    }

    if (tool === 'fillet' || tool === 'chamfer') {
      const hp = hitPoint(raw)
      const nb = hp ? cornerNeighbors(data, hp) : null
      if (hp && nb) {
        setCornerDrag({ pid: hp, corner: pos(hp), prev: nb.prev, next: nb.next, size: 0 })
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }

    // rectangle / circle: begin a drag
    setDrag({ start: snap, current: snap })
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const { sx, sy, cx0, cy0, scale } = panRef.current
      st.getState().setView({
        cx: cx0 - (e.clientX - sx) / scale,
        cy: cy0 + (e.clientY - sy) / scale,
        size: view.size,
      })
      return
    }
    const rawMove = toModelRaw(e.clientX, e.clientY)
    const snap = toModel(e.clientX, e.clientY)
    setCursor(snap)
    // Highlight the point a tool would act on: the line/dimension snap target, or
    // the loop corner the fillet/chamfer tool would round/bevel.
    let hover: PointId | null = null
    if (tool === 'line' || tool === 'dimension') hover = hitPoint(rawMove)
    else if (tool === 'fillet' || tool === 'chamfer') {
      const hp = hitPoint(rawMove)
      hover = hp && cornerNeighbors(data, hp) && canTreatCorner(data, hp) ? hp : null
    }
    setSnapPoint(hover)
    setProjHover(tool === 'project' ? hitProjection(rawMove) : null)
    if (arcDrag) {
      setArcDrag({ ...arcDrag, sagitta: signedOffset(rawMove, pos(arcDrag.a), pos(arcDrag.b)) })
      return
    }
    if (cornerDrag) {
      setCornerDrag({ ...cornerDrag, size: distance(cornerDrag.corner, rawMove) })
      return
    }
    if (moveRef.current) {
      st.getState().dragPoint(moveRef.current, snap[0], snap[1])
      return
    }
    if (drag) setDrag({ start: drag.start, current: snap })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    svgRef.current?.releasePointerCapture?.(e.pointerId)
    if (panRef.current) {
      panRef.current = null
      return
    }
    if (arcDrag) {
      const { a, b, sagitta } = arcDrag
      if (Math.abs(sagitta) < 0.5) {
        // Dragged (or clicked) back to flat: remove any arc on the segment.
        st.getState().removeSegmentArc(a, b)
      } else {
        const res = arcFromSagitta(pos(a), pos(b), sagitta)
        if (res) st.getState().setSegmentArc(a, b, res.center, res.ccw)
      }
      setArcDrag(null)
      return
    }
    if (cornerDrag) {
      const { pid, corner, prev, next, size } = cornerDrag
      const kind = tool === 'chamfer' ? 'chamfer' : 'fillet'
      const max = maxCornerSize(prev, corner, next, kind)
      if (max >= 0.1) {
        // A tiny drag (≈ a click) still rounds, using a sensible default.
        const minEdge = Math.min(distance(corner, prev), distance(corner, next))
        const wanted = size < 0.5 ? Math.max(1, minEdge * 0.25) : size
        st.getState().setCornerTreatment(pid, kind, Math.min(max, Math.max(0.1, wanted)))
        st.getState().select([{ t: 'point', id: pid }])
      }
      setCornerDrag(null)
      return
    }
    if (moveRef.current) {
      moveRef.current = null
      return
    }
    if (drag) {
      const { start, current } = drag
      if (tool === 'rectangle') {
        const x = Math.min(start[0], current[0])
        const y = Math.min(start[1], current[1])
        const w = Math.abs(current[0] - start[0])
        const h = Math.abs(current[1] - start[1])
        if (w > 0.5 && h > 0.5) st.getState().addRectangle(x, y, w, h)
      } else if (tool === 'circle') {
        const r = distance(start, current)
        if (r > 0.5) st.getState().addCircle(start[0], start[1], r)
      }
      setDrag(null)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'line' && lineDraft.length >= 3) {
      st.getState().addLoop(lineDraft)
      setLineDraft([])
      return
    }
    if (tool === null) {
      const cid = hitDimension(toModelRaw(e.clientX, e.clientY))
      if (cid) {
        const c = data.constraints.find((x) => x.id === cid)
        if (!c) return
        if (c.kind === 'distance' || c.kind === 'angle') startEditing(cid, c.value)
        else if (c.kind === 'radius') startEditing(cid, c.diameter ? c.value * 2 : c.value)
      }
    }
  }

  // ---- render data ----
  const grid = useMemo(() => {
    const { cx, cy, size } = view
    // With a square viewBox and preserveAspectRatio="meet", the visible model
    // range is wider (or taller) than `size` along the container's long axis.
    const visW = size * Math.max(aspect, 1)
    const visH = size * Math.max(1 / aspect, 1)
    const left = cx - visW / 2
    const right = cx + visW / 2
    const bottom = cy - visH / 2
    const top = cy + visH / 2
    const step = niceStep(size)
    const vs: { v: number; major: boolean }[] = []
    const hs: { v: number; major: boolean }[] = []
    for (let x = Math.ceil(left / step) * step; x <= right; x += step)
      vs.push({ v: x, major: Math.round(x / step) % 5 === 0 })
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step)
      hs.push({ v: y, major: Math.round(y / step) % 5 === 0 })
    return { left, right, bottom, top, vs, hs }
  }, [view, aspect])

  const vertexR = view.size * 0.0095
  const isSelPoint = (id: string) => selection.some((r) => r.t === 'point' && r.id === id)
  const isSelSeg = (a: string, b: string) =>
    selection.some(
      (r) => r.t === 'segment' && ((r.a === a && r.b === b) || (r.a === b && r.b === a)),
    )
  const isSelCircle = (id: string) => selection.some((r) => r.t === 'circle' && r.id === id)
  const isSelConstraint = (id: string) => selection.some((r) => r.t === 'constraint' && r.id === id)

  const previewRect =
    drag && tool === 'rectangle'
      ? {
          x: Math.min(drag.start[0], drag.current[0]),
          y: Math.min(drag.start[1], drag.current[1]),
          w: Math.abs(drag.current[0] - drag.start[0]),
          h: Math.abs(drag.current[1] - drag.start[1]),
        }
      : null
  const previewCircle =
    drag && tool === 'circle' ? { c: drag.start, r: distance(drag.start, drag.current) } : null

  // Line tool: hovering near the first draft vertex (with ≥3 points placed) will
  // close the loop on click — highlight it like a snap target so the closure is
  // visible before committing (mirrors the close test in onPointerDown).
  const closeLoopHover =
    tool === 'line' &&
    lineDraft.length >= 3 &&
    cursor != null &&
    distance(cursor, lineDraft[0].pos) <= CLOSE_DIST

  // dimension we're placing (follows cursor)
  const placePreview =
    placing && cursor
      ? (() => {
          const a = pos(placing.a)
          const b = pos(placing.b)
          const off = signedOffset(cursor, a, b)
          const n = normal(a, b)
          return { a, b, off, n, value: distance(a, b) }
        })()
      : null

  const renderDim = (a: Vec2, b: Vec2, off: number, value: number, key: string, color: string) => {
    const n = normal(a, b)
    const a2: Vec2 = [a[0] + n[0] * off, a[1] + n[1] * off]
    const b2: Vec2 = [b[0] + n[0] * off, b[1] + n[1] * off]
    const mid: Vec2 = [
      (a2[0] + b2[0]) / 2 + n[0] * fontSize * 0.7,
      (a2[1] + b2[1]) / 2 + n[1] * fontSize * 0.7,
    ]
    return (
      <g key={key}>
        <line
          x1={a[0]}
          y1={-a[1]}
          x2={a2[0]}
          y2={-a2[1]}
          stroke={color}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={b[0]}
          y1={-b[1]}
          x2={b2[0]}
          y2={-b2[1]}
          stroke={color}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={a2[0]}
          y1={-a2[1]}
          x2={b2[0]}
          y2={-b2[1]}
          stroke={color}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={mid[0]}
          y={-mid[1]}
          fontSize={fontSize}
          fill={color}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {r1(value)}
        </text>
      </g>
    )
  }

  // Model-space label position of any dimension constraint (for inline editing).
  const dimLabelModelPos = (c: Constraint): Vec2 | null => {
    if (c.kind === 'distance') {
      const a = pos(c.a)
      const b = pos(c.b)
      const n = normal(a, b)
      const off = c.offset ?? defaultOff
      return [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off]
    }
    if (c.kind === 'radius') return radiusLabelPos(c)
    if (c.kind === 'angle') return angleLabelPos(c)
    return null
  }

  /** Leader + label for a radius/diameter dimension. */
  const renderRadiusDim = (
    c: Extract<Constraint, { kind: 'radius' }>,
    color: string,
  ): React.ReactNode => {
    const info = radiusInfo(c)
    const lp = radiusLabelPos(c)
    if (!info || !lp) return null
    const ang = c.offset ?? Math.PI / 4
    const tip: Vec2 = [
      info.center[0] + Math.cos(ang) * info.r,
      info.center[1] + Math.sin(ang) * info.r,
    ]
    return (
      <g key={c.id}>
        <line
          x1={info.center[0]}
          y1={-info.center[1]}
          x2={lp[0]}
          y2={-lp[1]}
          stroke={color}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={tip[0]} cy={-tip[1]} r={vertexR * 0.7} fill={color} />
        <text
          x={lp[0]}
          y={-lp[1]}
          fontSize={fontSize}
          fill={color}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {c.diameter ? `⌀${r1(c.value * 2)}` : `R${r1(c.value)}`}
        </text>
      </g>
    )
  }

  /** Dimension arc + label for an angle dimension (polyline; avoids SVG arc-flag sign traps). */
  const renderAngleDim = (
    c: { a: PointId; b: PointId; c: PointId; d: PointId; offset?: number },
    value: number,
    key: string,
    color: string,
  ): React.ReactNode => {
    const info = angleInfo(c)
    if (!info) return null
    const off = c.offset ?? defaultOff
    const n = 24
    const pts: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const t = info.t1 + info.sweep * (i / n)
      pts.push([info.X[0] + Math.cos(t) * off, info.X[1] + Math.sin(t) * off])
    }
    const mid = info.t1 + info.sweep / 2
    const lp: Vec2 = [
      info.X[0] + Math.cos(mid) * (off + fontSize * 0.9),
      info.X[1] + Math.sin(mid) * (off + fontSize * 0.9),
    ]
    return (
      <g key={key}>
        <polyline
          points={pts.map(([x, y]) => pt(x, y)).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={lp[0]}
          y={-lp[1]}
          fontSize={fontSize}
          fill={color}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {r1(value)}°
        </text>
      </g>
    )
  }

  // Arc-tool live preview: the bowed segment at the current sagitta.
  const arcPreview = (() => {
    if (!arcDrag || Math.abs(arcDrag.sagitta) < 0.5) return null
    const a = pos(arcDrag.a)
    const b = pos(arcDrag.b)
    const res = arcFromSagitta(a, b, arcDrag.sagitta)
    if (!res) return null
    return [a, ...arcPoints(res.center, a, b, res.ccw), b]
  })()

  // Radius-dimension placement preview (leader follows the cursor angle).
  const radiusPlacePreview = (() => {
    if (!placingRadius || !cursor) return null
    const ctr = pos(placingRadius.c)
    let r = 0
    if (placingRadius.shape) {
      const s = data.shapes.find((x) => x.id === placingRadius.shape)
      r = s && s.kind === 'circle' ? s.r : 0
    } else if (placingRadius.a && placingRadius.b) {
      r = (distance(pos(placingRadius.a), ctr) + distance(pos(placingRadius.b), ctr)) / 2
    }
    if (r <= 0) return null
    const ang = Math.atan2(cursor[1] - ctr[1], cursor[0] - ctr[0])
    return {
      c: placingRadius.c,
      shape: placingRadius.shape,
      a: placingRadius.a,
      b: placingRadius.b,
      value: r,
      offset: ang,
    }
  })()

  // Angle-dimension placement preview (dim arc follows the cursor distance).
  const anglePlacePreview = (() => {
    if (!placingAngle || !cursor) return null
    const info = angleInfo(placingAngle)
    if (!info) return null
    const A = pos(placingAngle.a)
    const B = pos(placingAngle.b)
    const C = pos(placingAngle.c)
    const D = pos(placingAngle.d)
    const dd =
      ((Math.atan2(D[1] - C[1], D[0] - C[0]) - Math.atan2(B[1] - A[1], B[0] - A[0])) * 180) /
      Math.PI
    const norm = ((dd % 360) + 360) % 360
    const value = norm > 180 ? norm - 180 : norm
    return {
      ...placingAngle,
      offset: Math.max(fontSize, distance(cursor, info.X)),
      value,
    }
  })()

  const editPos = (() => {
    if (!editing) return null
    const c = data.constraints.find((x) => x.id === editing)
    if (!c) return null
    const mid = dimLabelModelPos(c)
    if (!mid) return null
    // Reads the live SVG transform (a ref) to place the HTML edit box over the
    // dimension; intentionally a render-time DOM measurement.
    // eslint-disable-next-line react-hooks/refs
    return screenPos(mid[0], mid[1])
  })()

  return (
    // Transparent so the locked 3D viewport (the sketch plane head-on, scene
    // dimmed) shows through behind the sketch geometry and projection lines.
    <div className="absolute inset-0 z-10">
      <svg
        ref={svgRef}
        viewBox={`${view.cx - view.size / 2} ${-view.cy - view.size / 2} ${view.size} ${view.size}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none"
        style={{ cursor: tool === null ? 'default' : 'crosshair', background: 'transparent' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {grid.vs.map(({ v, major }) => (
          <line
            key={`v${v}`}
            x1={v}
            y1={-grid.bottom}
            x2={v}
            y2={-grid.top}
            stroke={major ? '#3a4253' : '#1e222b'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {grid.hs.map(({ v, major }) => (
          <line
            key={`h${v}`}
            x1={grid.left}
            y1={-v}
            x2={grid.right}
            y2={-v}
            stroke={major ? '#3a4253' : '#1e222b'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {grid.bottom <= 0 && grid.top >= 0 && (
          <line
            x1={grid.left}
            y1={0}
            x2={grid.right}
            y2={0}
            stroke="#ff6188"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {grid.left <= 0 && grid.right >= 0 && (
          <line
            x1={0}
            y1={-grid.bottom}
            x2={0}
            y2={-grid.top}
            stroke="#7bd88f"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Revolve mode: the Y axis (x=0) is the lathe axis; the −X half is ignored. */}
        {outputMode === 'revolve' && (
          <>
            {grid.left < 0 && (
              <rect
                x={grid.left}
                y={-grid.top}
                width={Math.min(0, grid.right) - grid.left}
                height={grid.top - grid.bottom}
                fill="rgba(255,97,136,0.06)"
              />
            )}
            <line
              x1={0}
              y1={-grid.bottom}
              x2={0}
              y2={-grid.top}
              stroke="#7bd88f"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={fontSize * 0.5}
              y={-(grid.top - fontSize * 1.3)}
              fontSize={fontSize}
              fill="#7bd88f"
              textAnchor="start"
            >
              revolve axis →
            </text>
          </>
        )}

        {/* Reference: the existing scene sectioned by this plane (in-plane
            geometry only), one outline group per object. With the Project tool
            active a group is clickable to include it; the hovered one lights up. */}
        {projection.map((group, gi) => {
          const active = tool === 'project'
          const hot = active && gi === projHover
          return (
            <g key={`proj${gi}`}>
              {group.map((poly, i) => (
                <path
                  key={i}
                  d={path(poly)}
                  fill={hot ? 'rgba(123,216,143,0.12)' : 'rgba(150,165,190,0.06)'}
                  stroke={
                    hot ? '#7bd88f' : active ? 'rgba(150,165,190,0.75)' : 'rgba(150,165,190,0.4)'
                  }
                  strokeWidth={hot ? 2 : 1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )
        })}

        {/* Construction geometry is reference-only: dashed, unfilled, violet. */}
        {data.shapes.map((s) =>
          s.kind === 'circle' ? (
            <circle
              key={s.id}
              cx={pos(s.c)[0]}
              cy={-pos(s.c)[1]}
              r={s.r}
              fill={s.construction ? 'none' : 'rgba(110,168,254,0.18)'}
              stroke={isSelCircle(s.id) ? '#ffd866' : s.construction ? '#ab9df2' : '#6ea8fe'}
              strokeWidth={1.6}
              strokeDasharray={s.construction ? '5 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <path
              key={s.id}
              d={path(loopOutline(data, s))}
              fill={s.construction ? 'none' : 'rgba(110,168,254,0.16)'}
              stroke={s.construction ? '#ab9df2' : '#6ea8fe'}
              strokeWidth={1.6}
              strokeDasharray={s.construction ? '5 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}

        {segments
          .filter((s) => isSelSeg(s.a, s.b))
          .map((s, i) => {
            const a = pos(s.a)
            const b = pos(s.b)
            if (s.arc && data.points[s.arc.center]) {
              const arcPts = [a, ...arcPoints(pos(s.arc.center), a, b, s.arc.ccw), b]
              return (
                <polyline
                  key={i}
                  points={arcPts.map(([x, y]) => pt(x, y)).join(' ')}
                  fill="none"
                  stroke="#ffd866"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                />
              )
            }
            return (
              <line
                key={i}
                x1={a[0]}
                y1={-a[1]}
                x2={b[0]}
                y2={-b[1]}
                stroke="#ffd866"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}

        {data.constraints.map((c) => {
          const color = isSelConstraint(c.id) ? '#ffd866' : '#9fb4d8'
          if (c.kind === 'distance')
            return renderDim(pos(c.a), pos(c.b), c.offset ?? defaultOff, c.value, c.id, color)
          if (c.kind === 'radius') return renderRadiusDim(c, color)
          if (c.kind === 'angle') return renderAngleDim(c, c.value, c.id, color)
          return null
        })}

        {data.shapes.map((s) =>
          s.kind === 'circle' ? (
            <text
              key={`r${s.id}`}
              x={pos(s.c)[0]}
              y={-pos(s.c)[1]}
              fontSize={fontSize}
              fill="#9fb4d8"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              ⌀{r1(s.r * 2)}
            </text>
          ) : null,
        )}

        {Object.entries(data.points).map(([id, p]) => {
          const sel = isSelPoint(id) || id === dimA
          return p.fixed ? (
            <rect
              key={id}
              x={p.x - vertexR}
              y={-p.y - vertexR}
              width={vertexR * 2}
              height={vertexR * 2}
              fill={sel ? '#ffd866' : '#ff6188'}
            />
          ) : (
            <circle
              key={id}
              cx={p.x}
              cy={-p.y}
              r={vertexR}
              fill={sel ? '#ffd866' : '#dbe4f3'}
              stroke={sel ? '#fff' : 'none'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}

        {lineDraft.length > 0 && (
          <>
            <polyline
              points={lineDraft.map((e) => pt(e.pos[0], e.pos[1])).join(' ')}
              fill="none"
              stroke="#ffd866"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            {cursor && (
              <line
                x1={lineDraft[lineDraft.length - 1].pos[0]}
                y1={-lineDraft[lineDraft.length - 1].pos[1]}
                x2={cursor[0]}
                y2={-cursor[1]}
                stroke="#ffd86688"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {lineDraft.map((e, i) => (
              <circle
                key={i}
                cx={e.pos[0]}
                cy={-e.pos[1]}
                r={vertexR}
                fill={i === 0 ? '#ffd866' : '#fff'}
              />
            ))}
          </>
        )}

        {/* Snap-to-existing-point highlight */}
        {snapPoint && data.points[snapPoint] && (
          <circle
            cx={pos(snapPoint)[0]}
            cy={-pos(snapPoint)[1]}
            r={vertexR * 2.4}
            fill="none"
            stroke="#7bd88f"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Close-the-loop highlight: same snap ring on the first draft vertex. */}
        {closeLoopHover && (
          <circle
            cx={lineDraft[0].pos[0]}
            cy={-lineDraft[0].pos[1]}
            r={vertexR * 2.4}
            fill="none"
            stroke="#7bd88f"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {placePreview &&
          renderDim(
            placePreview.a,
            placePreview.b,
            placePreview.off,
            placePreview.value,
            'place',
            '#ffd866',
          )}

        {radiusPlacePreview &&
          renderRadiusDim(
            {
              id: 'place-r',
              kind: 'radius',
              c: radiusPlacePreview.c,
              ...(radiusPlacePreview.shape && { shape: radiusPlacePreview.shape }),
              ...(radiusPlacePreview.a && { a: radiusPlacePreview.a }),
              ...(radiusPlacePreview.b && { b: radiusPlacePreview.b }),
              value: radiusPlacePreview.value,
              offset: radiusPlacePreview.offset,
            },
            '#ffd866',
          )}

        {anglePlacePreview &&
          renderAngleDim(anglePlacePreview, anglePlacePreview.value, 'place-a', '#ffd866')}

        {arcPreview && (
          <polyline
            points={arcPreview.map(([x, y]) => pt(x, y)).join(' ')}
            fill="none"
            stroke="#ffd866"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {previewRect && previewRect.w > 0 && (
          <path
            d={path([
              [previewRect.x, previewRect.y],
              [previewRect.x + previewRect.w, previewRect.y],
              [previewRect.x + previewRect.w, previewRect.y + previewRect.h],
              [previewRect.x, previewRect.y + previewRect.h],
            ])}
            fill="rgba(255,216,102,0.15)"
            stroke="#ffd866"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {previewCircle && previewCircle.r > 0 && (
          <circle
            cx={previewCircle.c[0]}
            cy={-previewCircle.c[1]}
            r={previewCircle.r}
            fill="rgba(255,216,102,0.15)"
            stroke="#ffd866"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {cornerDrag &&
          (() => {
            const kind = tool === 'chamfer' ? 'chamfer' : 'fillet'
            const pts = cornerPoints(
              cornerDrag.prev,
              cornerDrag.corner,
              cornerDrag.next,
              kind,
              cornerDrag.size,
            )
            if (pts.length < 2) return null
            return (
              <polyline
                points={pts.map(([x, y]) => pt(x, y)).join(' ')}
                fill="none"
                stroke="#ffd866"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )
          })()}
      </svg>

      {editing && editPos && (
        <input
          ref={editRef}
          value={editText}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            else if (e.key === 'Escape') setEditing(null)
          }}
          className="absolute w-16 -translate-x-1/2 -translate-y-1/2 rounded border border-blue-500 bg-neutral-900 px-1 py-0.5 text-center text-sm text-white outline-none"
          style={{ left: editPos.x, top: editPos.y }}
        />
      )}

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/80 px-2 py-1 font-mono text-xs text-neutral-300">
        {cursor ? `x ${cursor[0]}  y ${cursor[1]} mm` : `${tool ?? 'select'} · XY plane · mm`}
      </div>
    </div>
  )
}

function sameRef(a: Ref, b: Ref): boolean {
  if (a.t !== b.t) return false
  if (a.t === 'segment' && b.t === 'segment')
    return (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a)
  if (a.t === 'point' && b.t === 'point') return a.id === b.id
  if (a.t === 'circle' && b.t === 'circle') return a.id === b.id
  if (a.t === 'constraint' && b.t === 'constraint') return a.id === b.id
  return false
}
