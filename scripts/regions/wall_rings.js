/* globals
canvas,
CONST
*/
"use strict";

/* Wall rings

Locate the area enclosed by walls at a clicked point, without maintaining a persistent graph.

1. Collect the wall segments for the current level, plus the inner scene rectangle.
2. Node the segments: split every segment wherever it crosses, touches or overlaps another.
3. Build a planar graph and prune dangling walls (vertices with fewer than two neighbors).
4. Trace every face of the graph. Faces traced counter-clockwise (positive area) are closed wall rings.
   Each connected group of walls also has one clockwise (negative area) outer ring.
5. The innermost ring is the smallest closed ring that contains the point.
6. Holes are the outer rings of other wall groups that lie inside the innermost ring,
   skipping any that are themselves inside another hole.
*/

const SNAP = 1000;       // Vertices closer than 1/1000 of a pixel are merged.
const DIST_TOL = 0.01;   // Pixels. Tolerance for touching and collinear tests.
const COLLINEAR = 1e-4;  // Sine of the angle below which a vertex is dropped from the final ring.

const snap = v => Math.round(v * SNAP) / SNAP;

// ----- NOTE: Public API ----- //

/**
 * Find the innermost closed wall ring around a point, and the wall rings inside it that are holes.
 * If no walls enclose the point, the inner scene rectangle is used.
 * @param {Point} point
 * @param {object} [opts]
 * @param {string} [opts.levelId]                     Level to use; default is the current level
 * @param {function} [opts.includeWall]               Optional (edge, wallDocument) => boolean filter
 * @param {boolean} [opts.includeDoors=true]          If true, include walls regardless of door state
 * @returns {{outer: number[], holes: number[][]}|null}   Flat point arrays; null if the point is outside
 *                                                    everything, including the scene rectangle
 */
export function findWallFill(point, opts = {}) {
  return findEnclosingFill(point, collectSegments(opts));
}

/**
 * Wall segments for a level, plus the inner scene rectangle.
 * Open doors are skipped because they do not close a ring.
 * @returns {number[][]}   Array of [ax, ay, bx, by]
 */
export function collectSegments({ levelId = canvas.level?.id, includeWall, includeDoors = true } = {}) {
  const segments = [];
  for ( const edge of canvas.edges.values() ) {
    if ( edge.type !== "wall" ) continue;
    const wallD = edge.object;
    if ( !wallD ) continue;
    if ( levelId && wallD.levels?.size && !wallD.levels.has(levelId) ) continue;
    if ( !includeDoors && wallD.door && wallD.ds === CONST.WALL_DOOR_STATES.OPEN ) continue;
    if ( includeWall && !includeWall(edge, wallD) ) continue;
    segments.push([edge.a.x, edge.a.y, edge.b.x, edge.b.y]);
  }

  const { x, y, right, bottom } = canvas.dimensions.sceneRect;
  segments.push([x, y, right, y], [right, y, right, bottom], [right, bottom, x, bottom], [x, bottom, x, y]);
  return segments;
}

/**
 * Core algorithm, separated from the canvas for testing.
 * @param {Point} point
 * @param {number[][]} segments   Array of [ax, ay, bx, by]
 * @returns {{outer: number[], holes: number[][]}|null}
 */
export function findEnclosingFill(point, segments) {
  const graph = buildGraph(nodeSegments(segments));
  const rings = traceRings(graph);

  // Innermost closed ring that contains the point.
  let inner;
  for ( const ring of rings ) {
    if ( ring.area <= 0 ) continue;
    if ( inner && ring.area >= inner.area ) continue;
    if ( pointInRing(point.x, point.y, ring.pts) ) inner = ring;
  }
  if ( !inner ) return null;

  // Outer ring of each other wall group that sits inside the innermost ring.
  const candidates = [];
  for ( const ring of rings ) {
    if ( ring.area >= 0 || ring.comp === inner.comp ) continue;
    const v = ring.pts[0];
    if ( pointInRing(v.x, v.y, inner.pts) ) candidates.push(ring);
  }

  // Drop groups nested inside another hole; they are already excluded.
  const holes = candidates.filter(ring => {
    const v = ring.pts[0];
    return !candidates.some(other => other !== ring && pointInRing(v.x, v.y, other.pts));
  });

  return {
    outer: ringToPoints(inner.pts),
    holes: holes.map(ring => ringToPoints(ring.pts)).filter(pts => pts.length >= 6)
  };
}

// ----- NOTE: Noding ----- //

/**
 * Split segments at every crossing, touching point and collinear overlap.
 * @param {number[][]} segments
 * @returns {number[][]}
 */
function nodeSegments(segments) {
  const info = [];
  for ( const [ax, ay, bx, by] of segments ) {
    if ( Math.hypot(bx - ax, by - ay) < DIST_TOL ) continue;
    info.push({
      ax, ay, bx, by,
      len: Math.hypot(bx - ax, by - ay),
      minX: Math.min(ax, bx), maxX: Math.max(ax, bx),
      minY: Math.min(ay, by), maxY: Math.max(ay, by),
      splits: []
    });
  }

  // Sweep along x so that only segments with overlapping x ranges are compared.
  info.sort((a, b) => a.minX - b.minX);
  for ( let i = 0; i < info.length; i += 1 ) {
    const s = info[i];
    for ( let j = i + 1; j < info.length; j += 1 ) {
      const o = info[j];
      if ( o.minX > s.maxX + DIST_TOL ) break;
      if ( o.minY > s.maxY + DIST_TOL || o.maxY < s.minY - DIST_TOL ) continue;
      intersectSegments(s, o);
    }
  }

  const out = [];
  for ( const s of info ) {
    s.splits.sort((a, b) => a.t - b.t);
    let prev = { x: s.ax, y: s.ay };
    for ( const split of s.splits ) {
      out.push([prev.x, prev.y, split.x, split.y]);
      prev = split;
    }
    out.push([prev.x, prev.y, s.bx, s.by]);
  }
  return out;
}

function addSplit(seg, t, x, y) {
  const tol = DIST_TOL / seg.len;
  if ( t > tol && t < 1 - tol ) seg.splits.push({ t, x, y });
}

function addEndpointSplit(seg, x, y) {
  const rx = seg.bx - seg.ax;
  const ry = seg.by - seg.ay;
  const t = (((x - seg.ax) * rx) + ((y - seg.ay) * ry)) / (rx * rx + ry * ry);
  addSplit(seg, t, x, y);
}

function intersectSegments(s, o) {
  const rx = s.bx - s.ax;
  const ry = s.by - s.ay;
  const sx = o.bx - o.ax;
  const sy = o.by - o.ay;
  const qpx = o.ax - s.ax;
  const qpy = o.ay - s.ay;
  const denom = (rx * sy) - (ry * sx);

  // Non-parallel segments.
  if ( Math.abs(denom) > 1e-9 * s.len * o.len ) {
    const t = ((qpx * sy) - (qpy * sx)) / denom;
    const u = ((qpx * ry) - (qpy * rx)) / denom;
    const tolS = DIST_TOL / s.len;
    const tolO = DIST_TOL / o.len;
    if ( t < -tolS || t > 1 + tolS || u < -tolO || u > 1 + tolO ) return;
    const x = s.ax + (t * rx);
    const y = s.ay + (t * ry);
    addSplit(s, t, x, y);
    addSplit(o, u, x, y);
    return;
  }

  // Parallel. Only collinear segments matter: the endpoints of each split the other.
  const dist = Math.abs((qpx * ry) - (qpy * rx)) / s.len;
  if ( dist > DIST_TOL ) return;
  addEndpointSplit(s, o.ax, o.ay);
  addEndpointSplit(s, o.bx, o.by);
  addEndpointSplit(o, s.ax, s.ay);
  addEndpointSplit(o, s.bx, s.by);
}

// ----- NOTE: Graph ----- //

/**
 * @param {number[][]} segments   Noded segments
 * @returns {Map<string, object>} Vertices keyed by snapped coordinates; each has x, y, nbrs (Set of keys)
 */
function buildGraph(segments) {
  const verts = new Map();
  const getVertex = (x, y) => {
    x = snap(x);
    y = snap(y);
    const key = `${x}|${y}`;
    let v = verts.get(key);
    if ( !v ) {
      v = { key, x, y, nbrs: new Set(), sorted: [], index: new Map(), comp: -1 };
      verts.set(key, v);
    }
    return v;
  };

  for ( const [ax, ay, bx, by] of segments ) {
    const a = getVertex(ax, ay);
    const b = getVertex(bx, by);
    if ( a === b ) continue;
    a.nbrs.add(b.key);
    b.nbrs.add(a.key);
  }

  // Prune dangling walls; they cannot be part of a closed ring.
  const queue = [...verts.values()].filter(v => v.nbrs.size < 2);
  while ( queue.length ) {
    const v = queue.pop();
    if ( !verts.has(v.key) ) continue;
    for ( const k of v.nbrs ) {
      const w = verts.get(k);
      w.nbrs.delete(v.key);
      if ( w.nbrs.size < 2 ) queue.push(w);
    }
    verts.delete(v.key);
  }

  // Order the neighbors around each vertex by angle.
  for ( const v of verts.values() ) {
    v.sorted = [...v.nbrs].map(key => {
      const w = verts.get(key);
      return { key, ang: Math.atan2(w.y - v.y, w.x - v.x) };
    }).sort((a, b) => a.ang - b.ang).map(d => d.key);
    v.sorted.forEach((key, i) => v.index.set(key, i));
  }

  // Label connected groups of walls.
  let comp = 0;
  for ( const start of verts.values() ) {
    if ( start.comp >= 0 ) continue;
    const stack = [start];
    start.comp = comp;
    while ( stack.length ) {
      const v = stack.pop();
      for ( const k of v.nbrs ) {
        const w = verts.get(k);
        if ( w.comp >= 0 ) continue;
        w.comp = comp;
        stack.push(w);
      }
    }
    comp += 1;
  }
  return verts;
}

/**
 * Trace every face of the planar graph.
 * At each vertex, take the neighbor just before the one we arrived from in ascending angle order.
 * Bounded faces come out with positive signed area; each wall group's outer ring is negative.
 * @param {Map<string, object>} verts
 * @returns {{pts: object[], area: number, comp: number}[]}
 */
function traceRings(verts) {
  const rings = [];
  const visited = new Set();
  for ( const start of verts.values() ) {
    for ( const firstKey of start.nbrs ) {
      if ( visited.has(`${start.key}>${firstKey}`) ) continue;
      const pts = [];
      let a = start;
      let b = verts.get(firstKey);
      while ( !visited.has(`${a.key}>${b.key}`) ) {
        visited.add(`${a.key}>${b.key}`);
        pts.push(a);
        const n = b.sorted.length;
        const nextKey = b.sorted[(b.index.get(a.key) - 1 + n) % n];
        a = b;
        b = verts.get(nextKey);
      }
      rings.push({ pts, area: signedArea(pts), comp: start.comp });
    }
  }
  return rings;
}

// ----- NOTE: Geometry helpers ----- //

function signedArea(pts) {
  let sum = 0;
  for ( let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1 ) {
    sum += (pts[j].x * pts[i].y) - (pts[i].x * pts[j].y);
  }
  return sum / 2;
}

/**
 * Even-odd point in ring test.
 */
function pointInRing(x, y, pts) {
  let inside = false;
  for ( let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1 ) {
    const a = pts[i];
    const b = pts[j];
    if ( (a.y > y) !== (b.y > y) && x < (((b.x - a.x) * (y - a.y)) / (b.y - a.y)) + a.x ) inside = !inside;
  }
  return inside;
}

/**
 * Flatten a ring to [x0, y0, x1, y1, ...], dropping vertices that only exist because of noding.
 */
function ringToPoints(pts) {
  const out = [];
  const n = pts.length;
  for ( let i = 0; i < n; i += 1 ) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const cross = (ax * by) - (ay * bx);
    const dot = (ax * bx) + (ay * by);
    if ( dot > 0 && Math.abs(cross) <= COLLINEAR * Math.hypot(ax, ay) * Math.hypot(bx, by) ) continue;
    out.push(cur.x, cur.y);
  }
  return out;
}