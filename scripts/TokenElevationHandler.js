/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { GEOMETRY_LIB_ID } from "./geometry/const.js";

export const PATCHES = {};
PATCHES.ELEVATION = {};

/**
 * @typedef {object} Edge2d
 * @prop {PIXI.Point} a
 * @prop {PIXI.Point} b
 */

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Also handles elevated tile "floors".
 */
export class TokenElevationHandler {

  static EPSILON = 1e-06;

  static TERRAIN_TYPES = new Set([
    `${MODULE_ID}.plateauTerrain`,
    `${MODULE_ID}.rampTerrain`,
    `${MODULE_ID}.stepsTerrain`,
    `${MODULE_ID}.hillTerrain`,
  ]);

  /**
   * @typedef {object} RegionTerrainData
   * @prop {RegionDocument} regionD     The region document to use
   * @prop {TerrainGeometry} geom       The geometry associated with this region
   * @prop {number} bottomZ              Region's bottom elevation (pixels), constant along the region.
   */

  /**
   * Gather every enabled terrain behavior's geometry on the token's scene, each with its bottomZ (pixels,
   * constant per region - only the top surface varies by type) and its RegionDocument (for `.parent`/level
   * checks, same as the ramp file).
   * @param {TokenDocument} tokenD
   * @returns {RegionTerrainData[]}
   */
  static activeTerrainRegions(tokenD) {
    const out = [];
    for ( const regionD of tokenD.parent?.regions ?? [] ) {
      for ( const behavior of regionD.behaviors ) {
        if ( behavior.disabled || !this.TERRAIN_TYPES.has(behavior.type) ) continue;
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.regions.geomForDocument(regionD);
        if ( !geom ) continue;
        const { bottomZ } = geom.elevationZ; // RegionGeometry#elevationZ - flat per region regardless of type.
        out.push({ regionD, geom, bottomZ });
        break; // Only the first enabled terrain behavior on a region counts (matches TerrainGeometry.terrainType).
      }
    }
    return out;
  }

  /**
   * Rewrite the movement waypoints of an about-to-be-submitted update so any stretch that passes above,
   * within, or out of an active terrain region (plateau, ramp, steps, or hill) is corrected, following the
   * four rules in resolveElevation. Call this from a `TokenDocument#_preUpdate` wrapper, before the original
   * method runs - see the ramp file's `injectRampWaypoints` for why this specific hook point is the only one
   * where the raw waypoints are still mutable, and why this only needs to handle stretches that don't cross a
   * region boundary (Foundry's own checkpoint/MOVE_IN/MOVE_OUT machinery, and a TOKEN_MOVE_IN/OUT/WITHIN
   * event handler mirroring the ramp file's #onTokenMove, still own every boundary crossing; this function's
   * job, like injectRampWaypoints's, is only to catch what produces no checkpoint at all).
   * @param {TokenDocument} tokenD
   * @param {object} changed
   * @param {object} options
   */
  static injectTerrainWaypoints(tokenD, changed, options) {
    const movement = options.movement?.[tokenD.id];
    if ( !movement || movement.planned || !movement.waypoints?.length ) return;
    if ( (movement.method === "undo") || (movement.method === "paste") ) return;

    const regions = this.activeTerrainRegions(tokenD);
    if ( !regions.length ) return; // Cheap early exit.

    const source = tokenD._source;
    const sceneFloorZ = tokenD.parent.levels.get(source.level)?.elevation.base ?? 0; // Pixels, per the plateau/ramp convention.

    const origin = { x: source.x, y: source.y, elevation: source.elevation, width: source.width,
      height: source.height, depth: source.depth, shape: source.shape, level: source.level };

    const rewritten = [];
    let previous = origin;
    let changedAny = false;
    for ( const waypoint of movement.waypoints ) {
      const followed = this.followTerrain(regions, tokenD, previous, waypoint, sceneFloorZ);
      if ( (followed.length !== 1) || (followed[0] !== waypoint) ) changedAny = true;
      rewritten.push(...followed);
      previous = followed.at(-1);
    }
    if ( changedAny ) movement.waypoints = rewritten;
  }

  /**
   * Correct one user-supplied segment against every active terrain region.
   * @param {RegionTerrainData[]} regions
   * @param {TokenDocument} tokenD
   * @param {object} from                 Object with x and y properties indicating location
   * @param {object} to                   Object with x and y properties indicating location
   * @param {number} sceneFloorZ          Floor for this scene, in pixel units
   * @returns {TokenMovementWaypoint[]}   Length 1 when nothing needs adjusting (returns `to` unchanged).
   */
  static followTerrain(regions, tokenD, from, to, sceneFloorZ) {
    const { terrainWalkActions, terrainFlightActions, terrainBurrowActions } = CONFIG[MODULE_ID];
    const action = terrainFlightActions.has(to.action) ? "fly"
      : terrainBurrowActions.has(to.action) ? "burrow"
      : terrainWalkActions.has(to.action) ? "walk"
      : null;
    if ( !action ) return [to]; // Exempt movement action: untouched.

    using fromXY = PIXI.Point.tmp.copyFrom(from);
    using toXY = PIXI.Point.tmp.copyFrom(to);

    // Per-region breakpoints along this segment (each an exact mesh-vertex/footprint-edge location - see
    // terrainBreakpoints.js). Merge all their x's into one master list so the rule engine can evaluate every
    // region together at each point, per resolveElevation's "highest in-play region wins" rule.
    const profiles = regions.map(r => ({ ...r, breakpoints: this._terrainBreakpoints(r.geom, fromXY, toXY) }));
    const masterXs = [...new Set(profiles.flatMap(p => p.breakpoints.map(b => b.x)))].sort((a, b) => a - b);

    const out = [];
    let currentElevation = from.elevation;
    let priorX = 0;
    for ( const x of masterXs ) {
      const candidates = profiles.map(p => ({ bottomZ: p.bottomZ, topZ: this._topAt(p.breakpoints, x) }));
      const target = this._resolveElevation(currentElevation, candidates, sceneFloorZ, action);

      if ( target !== currentElevation ) {
        // NOTE (flagged for integration testing): unlike the ramp file's #followRamps, a change here can be
        // either a slope-following correction (safe to fold into the outgoing waypoint at this x) or a
        // same-spot vertical climb/fall (when x === priorX, i.e., nothing moved but the rule's target still
        // changed - e.g. stepping onto a region's footprint edge where the token is already "within" per
        // elevation but was just "floating above" a moment ago). The ramp file used verticalMoves() for the
        // in-place case; the same helper applies here and should be reused rather than re-derived.
        out.push(this.pointAtX(from, to, x, target));
        currentElevation = target;
      }
      priorX = x;
    }

    const finalElevation = out.length ? out.at(-1).elevation : currentElevation;
    if ( (out.length === 0) && (finalElevation === to.elevation) ) return [to]; // No-op: preserve reference.
    const last = out.at(-1);
    if ( last && (last.x === to.x) && (last.y === to.y) ) {
      last.elevation = finalElevation; // Land exactly on the caller's x/y with the resolved elevation.
      return out;
    }
    out.push({ ...to, elevation: finalElevation });
    return out;
  }

  /**
   * Build a waypoint at distance x along the (from -> to) segment, at a given elevation.
   */
  static pointAtX(from, to, x, elevation) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const t = x / L;
    return { ...to, x: Math.round(from.x + (dx * t)), y: Math.round(from.y + (dy * t)), elevation,
      checkpoint: false, explicit: true, snapped: false };
  }


  // ----- NOTE: RegionCandidate ------ //

  /**
   * @typedef {object} RegionCandidate
   * @prop {number} bottomZ        Region's bottom elevation (pixels), constant along the region.
   * @prop {number|null} topZ      Region's top elevation at the query point (pixels), or null if the point
   *                                falls outside the region's XY footprint there.
   */

  /**
   * Resolve the elevation a token should have at one point, given every active terrain region there.
   * Implements, in order:
   *   1. ABOVE a region (walk/burrow) -> fall to its top.
   *   2. WITHIN a region, or moving into one (walk/fly) -> climb to its top.
   *   3. No terrain in play here (walk/burrow) -> fall to the scene floor ("leaving").
   *   4. A region whose bottom is still above the token ("floating") is never in play. Among regions that
   *      ARE in play, the highest wins (both for the "fall onto" and the "climb within" case).
   * Flying tokens only ever climb (rule 2); they are never made to fall (rules 1 and 3 don't apply to them).
   * @param {number} currentElevation
   * @param {RegionCandidate[]} candidates
   * @param {number} sceneFloorZ
   * @param {"walk"|"fly"|"burrow"} action    Anything else is treated as exempt (untouched).
   * @returns {number} The resolved elevation. Equal to currentElevation when no correction is needed.
   */
  static _resolveElevation(currentElevation, candidates, sceneFloorZ, action) {
    if ( action === "fly" ) {
      const within = candidates.filter(c => (c.topZ !== null) && (c.bottomZ <= currentElevation) && (currentElevation < c.topZ));
      if ( within.length ) return Math.max(...within.map(c => c.topZ));
      return currentElevation;
    }

    if ( (action !== "walk") && (action !== "burrow") ) return currentElevation; // Exempt action.

    // Rule 4: a region "floating above" (its own bottom is above the token) is never in play.
    const inPlay = candidates.filter(c => (c.topZ !== null) && (c.bottomZ <= currentElevation));

    const within = inPlay.filter(c => currentElevation < c.topZ);
    if ( within.length ) {
      if ( action === "burrow" ) return currentElevation; // Rule 2 excludes burrowing: no forced climb.
      return Math.max(...within.map(c => c.topZ)); // Rule 2 (walk): climb to the highest top among these.
    }

    const below = inPlay.filter(c => currentElevation >= c.topZ); // Rule 1: fall candidates.
    if ( below.length ) return Math.max(...below.map(c => c.topZ)); // Rule 4: highest wins.

    return sceneFloorZ; // Rule 3: nothing in play here -> open ground / leaving.
  }

  // ------ NOTE: TerrainBreakpoint ----- //


  static _terrainBreakpoints(terrainGeom, fromXY, toXY) {
    for ( const shape of terrainGeom.shapes ) {
      for ( const cutaway of shape.verticalSlice(fromXY, toXY) ) {

      }
    }

  }


  /**
   * @typedef {object} TerrainBreakpoint
   * @prop {number} x             Distance along the segment (pixels), 0 <= x <= L.
   * @prop {number|null} topZ     The region's top elevation there (pixels), or null outside its XY footprint.
   */

  /**
   * Exact breakpoints - in mesh-vertex resolution, no arbitrary sampling step - at which a single region's
   * top surface might change (a slope change, a riser/step jump, or a footprint edge), along one straight
   * XY segment.
   *
   * `verticalSlice` intersects the terrain's ENTIRE 3d mesh (including the vertical side faces at its own
   * footprint edge, and any riser faces for steps) with the infinite vertical plane through `fromXY`/`toXY`.
   * Every vertex it returns is a point where SOMETHING about the cross-section changes; `verticalSlice`
   * doesn't clip to the segment itself (it follows the infinite line), so results are clipped to [0, L] here.
   * x=0 and x=L are always included even where the region doesn't graze them, since the caller always needs
   * the segment's own endpoints regardless.
   *
   * A single x can be genuinely ambiguous: at a step's riser, or at a footprint edge, the elevation
   * "approaching" that x and "just past" it can differ discontinuously (there is no single correct answer to
   * "the elevation at exactly x=100" when x=100 is a vertical wall). So each raw mesh-x is queried on both
   * sides with a fixed, tiny sub-pixel nudge (not an approximation - it disambiguates a genuine step
   * discontinuity, the same way ray/CSG libraries break ties at a boundary) rather than once, producing two
   * breakpoints at (x-nudge) and (x+nudge) whenever they differ, or collapsing back to one when they agree (an
   * ordinary continuous vertex, e.g. a slope change on a ramp or hill). Between two consecutive breakpoints,
   * the top surface is guaranteed to be exactly linear - or, at a riser, a genuine near-zero-width jump - so a
   * caller only needs the two endpoint values, never intermediate sampling.
   *
   * @param {TerrainGeometry} terrainGeom          Has `.shapes` (GeometricPrimitive[]) and
   *                                        `elevationAtCanvasLocation(pt, { testContainment })`.
   * @param {PIXI.Point} fromXY
   * @param {PIXI.Point} toXY
   * @param {number} [nudge=0.5]            Sub-pixel offset used to disambiguate a discontinuity at a vertex.
   * @returns {TerrainBreakpoint[]}          Sorted ascending by x. May contain adjacent entries at (nearly)
   *                                        the same x, representing a jump; that is not deduplication noise.
   */
  static _terrainBreakpoints(terrainGeom, fromXY, toXY, nudge = 0.5) {
    const EPSILON = this.EPSILON;
    using delta = toXY.subtract(fromXY);
    const length = delta.magnitude();
    using dir = PIXI.Point.tmp;
    if ( length.almostEqual(0, EPSILON) ) dir.set(0, 0);
    else dir.multiplyScalar(1/length);

    const vertexXs = new Set();
    if ( length.strictlyGreaterThan(0, EPSILON) ) {
      for ( const shape of terrainGeom.shapes ) {
        for ( const cutaway of shape.verticalSlice(fromXY, toXY) ) {
          for ( const pt of cutaway.iteratePoints() ) {
            if ( pt.x.almostBetween(0, length) ) vertexXs.add(Math.min(length, Math.max(0, pt.x)));
          }
        }
      }
    }

    // Collapse near-duplicate vertex x's (mesh noise) into single candidate locations before nudging.
    const sortedVertexXs = [...vertexXs].sort((a, b) => a - b);
    const candidates = [sortedVertexXs[0]];
    for ( let i = 1, n = sortedVertexXs.length; i < n; i += 1 ) {
      const x = sortedVertexXs[i];
      if ( (x - candidates.at(-1)) > EPSILON ) candidates.push(x);
    }

    using canvasLoc = PIXI.Point.tmp;
    const opts = { testContainment: true };
    const queryAt = x => {
      fromXY.add(dir.multiplyScalar(x, canvasLoc), canvasLoc); // fromXY + (dir * x)
      return terrainGeom.elevationAtCanvasLocation(canvasLoc, opts);
    };

    const breakpoints = [];
    const push = (x, topZ) => {
      const last = breakpoints.at(-1);
      if ( last && (last.x - x).almostEqual(0, EPSILON) && (last.topZ === topZ) ) return; // True duplicate.
      breakpoints.push({ x: Math.min(length, Math.max(0, x)), topZ });
    };

    push(0, queryAt(0));
    for ( const x of candidates ) {
      if ( x.almostLessThan(0, EPSILON) || x.almostGreaterThan(length, EPSILON) ) continue; // Endpoints handled separately (below), not nudged past the segment.
      const left = queryAt(Math.max(0, x - nudge));
      const right = queryAt(Math.min(length, x + nudge));
      if ( left === right ) push(x, left); // Continuous vertex (e.g. a ramp/hill slope change): one point suffices.
      else { push(x - nudge, left); push(x + nudge, right); } // Discontinuity (riser or footprint edge).
    }
    push(length, queryAt(length));

    return breakpoints;
  }

  /**
   * Linear interpolation of a region's top height at an arbitrary x between its breakpoints.
   * At a jump (two adjacent breakpoints at ~ the same x with different topZ), resolves to whichever side x
   * falls on rather than averaging across the discontinuity.
   * Returns null when x falls where the region's footprint doesn't reach.
   * @param {TerrainBreakpoint[]} breakpoints    From terrainBreakpoints(), sorted ascending.
   * @param {number} x
   * @returns {number|null}
   */
  static _topAt(breakpoints, x) {
    const EPSILON = this.EPSILON;
    for ( let i = 0; i < breakpoints.length - 1; i++ ) {
      const lo = breakpoints[i];
      const hi = breakpoints[i + 1];
      if ( x.almostBetween(lo, hi, EPSILON) ) {
        if ( (lo.topZ === null) || (hi.topZ === null) ) {
          if ( (x - lo.x).almostEqual(0, EPSILON) ) return lo.topZ;
          if ( (x - hi.x).almostEqual(0, EPSILON) ) return hi.topZ;
          return null;
        }
        if ( (hi.x - lo.x).almostEqual(0, EPSILON) ) return (x - lo.x <= hi.x - x) ? lo.topZ : hi.topZ; // At/near a jump.
        const t = (x - lo.x) / (hi.x - lo.x);
        return lo.topZ + (t * (hi.topZ - lo.topZ));
      }
    }
    const only = (x <= breakpoints[0].x) ? breakpoints[0] : breakpoints.at(-1);
    return only.topZ;
  }

}


/**
 * Wrap TokenDocument#_preUpdate. Register alongside injectRampWaypoints - both can coexist on the same
 * _preUpdate wrapper, or as two separate libWrapper registrations; either is fine since each only touches
 * `options.movement[tokenD.id].waypoints` and reads the fully-updated array each time it runs.
 */
async function terrainPreUpdateToken(wrapped, changed, options, user) {
  TokenElevationHandler.injectTerrainWaypoints(this, changed, options);
  return wrapped(changed, options, user);
}


PATCHES.ELEVATION.WRAPS = {
  _preUpdate: terrainPreUpdateToken,
}
