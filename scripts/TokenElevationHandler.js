/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { GEOMETRY_LIB_ID } from "./geometry/const.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { gridUnitsToPixels } from "./geometry/util.js";
import { Draw } from "./geometry/Draw.js";
import { AABB2d } from "./geometry/AABB.js";
import { TerrainGeometry } from "./GeometricPrimitives/TerrainGeometry.js";
import { fastFlag } from "./util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";

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

  static ELEVATION_LOCATIONS = {
    OUTSIDE: 0,       // 0000 in binary
    BELOW: 2,         // 0010
    GROUND: 4,        // 0100
    ABOVE: 8,         // 1000

    // Synonyms
    BURROWING: 2,
    FLYING: 8,
    FLOATING: 8,
  }

  static VERTICAL_LOCATIONS = {
    NONE: 0,           // 000000
    LEFT: 16,          // 010000
    RIGHT: 32,         // 100000
  }

  static DOWN = new PIXI.Point(0, -1);

  static UP = new PIXI.Point(0, 1);

  // ----- NOTE: Static methods ----- //

  /**
   * Retrieve all terrain regions. (Currently those representing plateaus, ramps, steps, or hills.)
   * @param {string} [levelId]  If provided, limit to regions seen from this level.
   *   Defaults to the current level (canvas.level.id).
   *   Use "" to include all regions.
   *
   * @returns {RegionDocument[]}
   */
  static terrainRegions(levelId = canvas.level.id) {
    return [...canvas.regions.documentCollection.values()].filter(regionD => {
      if ( !TerrainGeometry.isElevated(regionD) ) return false;
      if ( !levelId ) return true;
      return regionD.levels.has(levelId);
    });
  }

  /**
   * Retrieve all terrain regions. (Currently those representing plateaus, ramps, steps, or hills.)
   * @param {string} [levelId]  If provided, limit to regions seen from this level.
   *   Defaults to the current level (canvas.level.id).
   *   Use "" to include all regions.
   *
   * @type {TileDocument[]}
   */
  static terrainTiles(levelId = canvas.level.id) {
    return [...canvas.tiles.documentCollection.values()].filter(tileD => {
      if ( fastFlag(tileD, FLAGS.TILE_ALPHA_SHAPE) === FLAGS.TILE_ALPHA_SHAPE_OPTIONS.IGNORE ) return false;
      if ( !levelId ) return true;
      return tileD.levels.has(levelId);
    });
  }

  /**
   * Filter region by a 2d segment.
   * @param {(Region|RegionDocument)} region          Region to consider
   * @param {Point} start                             Start of the path
   * @param {Point} end                               End of the path
   * @returns {(Region|RegionDocument)} Region that may intersect the start|end segment.
   */
  static regionWithinXYSegment(region, start, end) {
    const geom = this.geometryForRegion(region);
    return geom.aabb.overlapsSegment(start, end, ["x", "y"]);
  }

  /**
   * Filter tile by a 2d segment.
   * @param {(Tile|TileDocument)[]} tile          Tile to consider
   * @param {Point} start                         Start of the path
   * @param {Point} end                           End of the path
   * @returns {(Tile|TileDocument)} Tile that may intersect the start|end segment
   */
  static tileWithinXYSegment(tile, start, end) {
    const geom = this.geometryForTile(tile);
    return geom.aabb.overlapsSegment(start, end, ["x", "y"]);
  }

  /**
   * Thickness, in pixels, of the slab used to represent a flat (zero-thickness) tile in a slice.
   * See QuadPrimitive#verticalSlice.
   * @type {number}
   */
  static TILE_THICKNESS = 1;

  /**
   * Retrieve the geometry for a region.
   * @param {Region|RegionDocument} region
   * @returns {TerrainGeometry|undefined}
   */
  static geometryForRegion(region) {
    const regionD = region.document || region;
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.regions.geomForDocument(regionD);
  }

  /**
   * Retrieve the geometry for a tile.
   * @param {Tile|TileDocument} tile
   * @returns {TileGeometry|undefined}
   */
  static geometryForTile(tile) {
    const tileD = tile.document || tile;
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.tiles.geomForDocument(tileD);
  }


  // ----- NOTE: Constructor ----- //

  token;

  regions = [];

  tiles = [];

  cutaways = [];

  constructor(token) {
    this.token = token;
  }

  start = new PIXI.Point();

  end = new PIXI.Point();

  levelId = "";

  get floor() { return gridUnitsToPixels(canvas.level.elevation.base); }

  to2d(pt3d) { return CutawayPolygon.to2d(pt3d, this.start, this.end); }

  from2d(cutawayPt) { return CutawayPolygon.from2d(cutawayPt, this.start, this.end); }

  /**
   * Add spacer to the start and end to ensure that cutaway polygons extend beyond the desired
   * start/end point.
   * This avoids issues where the path artificially moves down or up b/c it is at the cutoff.
   * This sets the start and end properties.
   * @param {PIXI.Point} start
   * @param {PIXI.Point} end
   */
  _setStartAndEnd(start, end) {
    using startXY = PIXI.Point.fromObject(start);
    using endXY = PIXI.Point.fromObject(end);
    if ( startXY.equals(endXY) ) startXY.x += 1;  // Arbitrarily extend so there is a cutaway x/y surface.
    const distXY = PIXI.Point.distanceBetween(startXY, endXY)
    startXY.towardsPoint(endXY, distXY + 1, this.end);
    endXY.towardsPoint(startXY, distXY + 1, this.start);
    this.start.z = start.z ?? (start.elevation ? gridUnitsToPixels(start.elevation) : 0);
    this.end.z = end.z ?? (end.elevation ? gridUnitsToPixels(end.elevation) : 0);
    this.start.roundDecimals(1);
    this.end.roundDecimals(1);
  }

  _initialize(start, end, levelId = canvas.level.id) {
    // this._setStartAndEnd(start, end);
    this.start.copyFrom(start);
    this.end.copyFrom(end);
    this.start.roundDecimals(1);
    this.end.roundDecimals(1);

    this.levelId = levelId;
    this.cutaways.length = 0;

    // Find regions within the start|end path.
    this.regions = this.constructor.terrainRegions(levelId).filter(region => this.constructor.regionWithinXYSegment(region, start, end));
    this.tiles = this.constructor.terrainTiles(levelId).filter(tile => this.constructor.tileWithinXYSegment(tile, start, end));

    // Slice each region and tile with the vertical plane through the start|end path.
    // Slices are in cutaway space:
    //   - x is linear distance from start
    //   - y is elevation in pixels
    for ( const region of this.regions ) {
      const geom = this.constructor.geometryForRegion(region);
      const elevs = geom.elevationZ;
      this.cutaways.push(...geom.verticalSlice(this.start, this.end, elevs));
    }

    for ( const tile of this.tiles ) {
      const geom = this.constructor.geometryForTile(tile);
      const elevs = geom.elevationZ;
      const geomSubtype = fastFlag(geom.placeableDocument, FLAGS.TILE_ALPHA_SHAPE) || FLAGS.TILE_ALPHA_SHAPE_OPTIONS.CALCULATED;
      this.cutaways.push(...geom[geomSubtype].verticalSlice(this.start, this.end, elevs));
    }

    // Transition the cutaways to linear distance, not distance-squared.
    this.cutaways = this.cutaways.map(cutaway => new CutawayHandler(cutaway));
  }


  // ----- NOTE: Primary methods ----- //

  /**
   * Determine the path between a and b that accounts for terrain regions and terrain tiles
   * along the way.
   * Points a and b should be on the start|end segment; otherwise this will be reinitialized.
   */
  constructPath(a, b, { flying, burrowing, walking, levelId, initialize = true } = {}) {
    a.roundDecimals(1);
    b.roundDecimals(1);
    if ( a.equals(b) ) return [a];

    // If no cutaways, allow free movement.
    if ( !this.cutaways.length ) return [a, b];

    flying ??= this.flying;
    burrowing ??= this.burrowing;
    walking ??= this.walking;

    // Initialize only if needed. If initialize is false, presume initialization is not required.
    if ( initialize ) initialize = this._initializationRequired(a, b, levelId);

    // Simple case: Token unbound by terrain; can fly and burrow!
    if ( flying && burrowing || !(flying || burrowing || walking) ) return [a, b];

    // Vertical-only move.
    if ( a.x.almostEqual(b.x) && a.y.almostEqual(b.y) ) return this.verticalOnlyMove(a, b.z, { flying, walking, burrowing, initialize });

    if ( burrowing ) return this.constructBurrowingPath(a, b, initialize);
    if ( flying ) return this.constructFlyingPath(a, b, initialize);
    return this.constructWalkingPath(a, b, initialize);
  }

  /**
   * Do we need to reinitialize the regions and tiles prior to calculating this path.
   * Currently means: Are points a and b sufficiently close to the start|end segment?
   * @param {Point3d} a
   * @param {Point3d} b
   * @param {string} levelId
   * @returns {boolean}
   */
  _initializationRequired(a, b, levelId = canvas.level.id) {
    if ( levelId !== this.levelId ) return true
    const { start, end } = this;
    const epsilon = 1e-01; // Need not be overly precise here.
    using a2d = a.to2d();
    using b2d = b.to2d();

    const aEqualsStart = start.almostEqual(a2d, epsilon);
    const bEqualsEnd = end.almostEqual(b2d, epsilon);
    if ( aEqualsStart && bEqualsEnd ) return false;
    const aIsCollinear = aEqualsStart || foundry.utils.orient2dFast(start, end, a2d).almostEqual(0, epsilon);
    if ( !aIsCollinear ) return true;

    const bIsCollinear = bEqualsEnd || foundry.utils.orient2dFast(start, end, b2d).almostEqual(0, epsilon);
    if ( !bIsCollinear ) return true;

    // Finally, a and b must be within the start|end segment.
    // Bounds test.

    function isWithinBoundingBox(p, c, d) {
      const xMinMax = Math.minMax(c.x, d.x);
      const yMinMax = Math.minMax(c.y, d.y);
      return p.x.almostGreaterThan(xMinMax.min)
          && p.x.almostLessThan(xMinMax.max)
          && p.y.almostGreaterThan(yMinMax.min)
          && p.y.almostLessThan(yMinMax.max);
    }

    // Verify containment of both endpoints.
    return isWithinBoundingBox(a2d, start, end)
         & isWithinBoundingBox(b2d, start, end);
  }


  #verifyPath2d(path2d) {
    if ( !path2d.length ) throw Error("Path is empty.");
    if ( path2d.length > 9999 ) throw Error("Path is too long.");
    if ( path2d.some(pt => isNaN(pt.x) || isNaN(pt.y)) ) throw Error("Path has NaN.");
    if ( path2d.some(pt => pt.y > 100000 || pt.y < -100000) ) throw Error("Path elevation error");
  }

  /* ----- NOTE: Vertical climb ----- */

  verticalOnlyMove(a, desiredElevation, { flying, burrowing, walking, initialize = true } = {}) {
    a.roundDecimals(1);
    if ( a.z === desiredElevation ) return [a];

    // If no cutaways at this location, allow free movement.
    if ( !this._supportingFloorEdge(a, this.cutaways) ) return [a, ElevatedPoint.tmp.set(a.x, a.y, desiredElevation)];

    flying ??= this.flying;
    burrowing ??= this.burrowing;
    walking ??= this.walking
    if ( initialize ) this._initialize(a, a);
    using b = ElevatedPoint.tmp.set(a.x, a.y, desiredElevation);
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);


    // Burrowing
    if ( burrowing ) {
      const path2d = this.#connectBurrowingPathToEnd([a2d], a, b, a2d, b2d);
      return path2d.map(pt => this.from2d(pt));

    // Flying
    } else if ( flying ) {
      const path2d = this.#connectFlyingPathToEnd([a2d], a, b, a2d, b2d);
      return path2d.map(pt => this.from2d(pt));

    // Walking
    } else {
      // Does not consider more complex scenarios where multiple cutaway edges are stacked but with a gap.
      // Assumes that if currently on a cutaway edge, can move all the way to the top of the edge.
      // Also assumes movement up only on left side and movement down only on right side.
      if ( desiredElevation > a.z ) { // Moving up.
        for ( const cutaway of this.cutaways ) {
          const loc = cutaway._elevationTypeAndEntry(a2d);
          if ( loc.edge === this.constructor.VERTICAL_LOCATIONS.LEFT ) {
            // We are at the edge of a terrain, so we can move up.
            a2d.y = Math.min(loc.floor, desiredElevation);
            if ( a2d.y === desiredElevation ) return [a, this.from2d(a2d)];
          }
        }
      } else { // Moving (falling) down.
        const support = this._nearestSupport(a2d);
        a2d.y = Math.max(support.elevation, desiredElevation);
        if ( a2d.y === desiredElevation ) return [a, this.from2d(a2d)];
      }
    }

    return [a];
  }

  /* ----- NOTE: Walking ----- */

  get walking() { return this.constructor.tokenIsWalking(this.token); }

   /* Walking
      Walk along terrain surfaces, falling to next support when the terrain ends.
      • Cannot move vertically unless at a terrain intersection or moving along ramp/steps surface.
      • Cannot move within a terrain.

      Algorithm:
      1. If on a region. Follow the region's surface until it ends or intersects another region.
      2. If above a region. Move vertically down.
      3. If below a region. Move vertically up.
    */
  constructWalkingPath(a, b, initialize = true) {
    if ( initialize ) this._initialize(a, b);
    using a2d = this.to2d(a);
    using b2d = this.to2d(b);
    let path2d = [];
    try {
      path2d = this._constructWalkingPath(a2d, b2d);
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructWalkingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }
    const path = path2d.map(pt => this.from2d(pt).roundDecimals(1));
    path2d.forEach(pt => pt.release());
    return path;
  }


  /**
   * Build walking path from start2d to end2d.
   * @param {PIXI.Point} start2d
   * @param {PIXI.Point} end2d          Must be different from start2d.
   */
  _constructWalkingPath(start2d, end2d, mode = "walking") {
   /*
    Build a walking-style path from start2d to end2d by sweeping left to right through the terrain
    breakpoints, rather than tracing polygon edges. Used as the base path for walking, burrowing, and
    flying: burrowing and flying refine it afterwards (shortcut/anchor passes) to tunnel or fly direct
    where a straight diagonal would do.

    Areas of the start|end line that are not under, over, or within any terrain are left untouched --
    only the sub-range actually spanned by terrain (clamped to [start2d.x, end2d.x]) is swept. Outside
    that range the path is just the input segment: no terrain means nothing to compute.

    Within the swept range, at each breakpoint the highest terrain top covering that x wins ("highest
    top wins" for overlapping solids). Walking and burrowing always track that top exactly (climbing,
    following a descending ramp/steps down, or falling onto it from above). Flying only reacts when it
    would collide (z at or below the top); otherwise it is unaffected and keeps its prior elevation.

    Leaving all terrain (no solid covers x) snaps to the scene floor, per mode:
      - walking:   z := floor (exact)
      - burrowing: z := min(z, floor)  -- never pulled up to the surface, only ever pulled down to it
      - flying:    z := max(z, floor)  -- never pulled below the floor, only ever pulled up to it
    Both clamped forms are idempotent once satisfied, so travel stays flat (parallel to the floor)
    until the next terrain is reached, with no separate "carry flat" state needed.
    */

    start2d.roundDecimals(1);
    end2d.roundDecimals(1);
    const terrain = this.cutaways;

    // If no terrain, pass through the segment unmodified.
    if ( !terrain.length ) return [start2d, end2d];

    using tmpPt = PIXI.Point.tmp;
    const floor = this.floor;
    const checkpoints = [];
    const addCheckpoint = curr => {
      const last = checkpoints.at(-1);
      if ( last && last.almostEqual(curr) ) return;
      checkpoints.push(curr.clone());
    };



    // Restrict work to the terrain actually overlapping this segment, based on x-span.
    let tMin = Number.POSITIVE_INFINITY;
    let tMax = Number.NEGATIVE_INFINITY;
    const relevant = [];
    for ( const handler of terrain ) {
      if ( !handler.aabb.overlapsSegment(start2d, end2d, ["x"]) ) continue; // Not on this segment.
      relevant.push(handler);
      tMin = Math.min(tMin, handler.aabb.min.x);
      tMax = Math.max(tMax, handler.aabb.max.x);
    }
    if ( !relevant.length ) return [start2d, end2d];
    tMin = Math.max(tMin, start2d.x);
    tMax = Math.min(tMax, end2d.x);

    // Sort and deduplicate breakpoints along x.
    // Each breakpoint represents a top-surface vertex within the segment.
    // Between consecutive breakpoints, every handler's top is linear or constant.
    // Change elevation at every breakpoint based on highest-top-wins.
    const breakpointSet = new Set([tMin, tMax]);
    for ( const handler of relevant ) {
      for ( const x of handler.topBreakpoints() ) {
        if ( x.between(tMin, tMax) ) breakpointSet.add(x);
      }
    }
    const breakpoints = [...breakpointSet].sort((a, b) => a - b); // Sort low to high.

    // Leave input line untouched up to where terrain begins.
    addCheckpoint(start2d);


    // Entry elevation at tMin is whatever the input line would be there.
    // Test tMin itself against the terrain just like every other breakpoint,
    // so that a region that floats above is correctly excluded.
    using delta = end2d.subtract(start2d);
    if ( mode === "walking" ) delta.y = start2d.y; // Move in flat line when walking.
    let z = delta.x.almostEqual(0) ? start2d.y
      : start2d.y + (delta.y * ((tMin - start2d.x) / delta.x));

    // Add the point of entry.
    addCheckpoint(tmpPt.set(tMin, z))

    // Loop through the breakpoints to find the highest valid elevation for each.
    for ( let i = 0, n = breakpoints.length; i < n; i += 1 ) {
      const x = breakpoints[i];

      // Highest top wins.
      let bestTop = null;
      for ( const handler of relevant ) {
        const top = handler.topAt(x);
        if ( top === null ) continue;
        const bottom = handler.bottomAt(x) ?? Number.NEGATIVE_INFINITY; // No bottom edge found: don't exclude.

        if ( bottom > z ) continue; // Floating above the token; ineligible.
        if ( bestTop === null || top > bestTop ) bestTop = top;
        if ( top !== null && (bestTop === null || top > bestTop)) bestTop = top;
      }

      if ( bestTop === null ) {
        // No terrain covers x. Leaving terrain (or still in a gap between regions).
        z = mode === "burrowing" ? Math.min(z, floor)
          : mode === "flying" ? Math.max(z, floor)
            : floor;
      } else if ( mode === "flying" ) {
        if ( z <= bestTop ) z = bestTop; // Would otherwise collide, so go over the top. Otherwise fly.
      } else z = bestTop; // Ride the slope exactly if walking or burrowing.

      addCheckpoint(tmpPt.set(x, z));
    }

    // Trailing straight segment: Input line, untouched, from where terrain ends to actual endpoint.
    if ( tMax < end2d.x ) {
      const finalZ = mode === "walking" ? floor : z;
      addCheckpoint(tmpPt.set(end2d.x, finalZ));
    }

    // Avoid Token##preUpdateMovement treating a single-point path as unconstrained and continuing past it.
    if ( checkpoints.length === 1 ) return [checkpoints[0], checkpoints[0].clone()];
    return checkpoints;
  }

  /* ----- NOTE: Burrowing ----- */

  get burrowing() { return this.constructor.tokenIsBurrowing(this.token); }

  constructBurrowingPath(a, b, initialize = true) {
    if ( initialize ) this._initialize(a, b);
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);
    let path2d = [];
    try {
      path2d = this._constructWalkingPath(a2d, b2d, "burrowing");
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructWalkingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }

    // Can we reach the end point? If the end is below but blocked by a cutaway, try to connect the two.
    path2d = this.#connectBurrowingPathToEnd(path2d, a, b, a2d, b2d);

    // Run anchor algorithm locate shortcuts along diagonals.
    try {
      path2d = this._constructBurrowingPath(path2d, b2d);
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructBurrowingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }
    const path = path2d.map(pt => this.from2d(pt).roundDecimals(1));
    path2d.forEach(pt => pt.release());
    return path;
  }

  #connectBurrowingPathToEnd(path2d, a, b, a2d, b2d) {
    a2d ??= this.to2d(a);
    b2d ??= this.to2d(b);

    // Are we already at the endpoint?
    const pathEnd = path2d.at(-1);
    if ( pathEnd.almostEqual(b2d) ) return path2d;

    // Could we get there by burrowing without hitting anything?
    if ( this.#foundBurrowingShortcut(pathEnd, b2d) ) {
      path2d.push(b2d);
      return path2d;
    }

    return path2d;
  }


  /* Can we get there faster by burrowing?
    Track elevation changes:
    Anchors:
    - When on ground
    - When burrowing

    Test anchors:
    - When moving down, test if we can get there faster using the anchor position.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor in case the regions connect/overlap.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
  _constructBurrowingPath(path, b2d) {
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const anchors = [];
    const MAX_ITER = 10000;
    let nIters = 0;
    let prevWaypoint = path[0];
    const startingHandler = this._nearestSupport(prevWaypoint);
    if ( startingHandler.location === BELOW || startingHandler.location === GROUND ) anchors.push(0)

    // Add in burrowing endpoint if present.
    if ( !path.at(-1).almostEqual(b2d) && this._nearestSupport(b2d).location === BELOW ) {
      if ( this.#foundBurrowingShortcut(path.at(-1), b2d) ) path.push(b2d);
    }

    for ( let i = 1, iMax = path.length; i < iMax; i += 1 ) {
      nIters += 1;
      if ( nIters > MAX_ITER ) break;
      const currWaypoint = path[i];

      // GROUND: moving right-to-left.
      // BELOW: moving vertical up (BELOW -> GROUND)
      // ABOVE: moving vertical down (ABOVE -> GROUND)
      const moveType = currWaypoint.x > prevWaypoint.x ? GROUND : currWaypoint.y > prevWaypoint.y ? BELOW : ABOVE;

      // Test anchors.
      // If can get from anchor to waypoint while always within at least one region, can burrow there.
      // Test the current waypoint if moving right-to-left or above-to-ground.
      if ( moveType === GROUND || moveType === ABOVE ) {
        for ( const [idx, anchor] of anchors.entries() ) {
          const anchorPt = path[anchor];
          if ( !this.#foundBurrowingShortcut(currWaypoint, anchorPt) ) continue;
          const nDeletions = i - anchor - 1; // Delete intermediate waypoints
          path.splice(anchor+1, nDeletions);
          anchors.splice(idx);
          i -= nDeletions; // Reset i to the next waypoint after the deletions.
          iMax = path.length
        }
      }

      // Set new anchors for the previous point.
      switch ( moveType ) {
        case GROUND:                     // prev waypoint is ground and not at right edge.
        case BELOW: anchors.push(i - 1); // prev waypoint is below (left edge)
      }
    }
    return path;
  }

  #foundBurrowingShortcut(testPoint, anchor) {
    // Allow movement vertically down through regions/tiles.
    // (Includes falling straight down or burrowing, then falling, etc.)
    if ( testPoint.x.almostEqual(anchor.x) && testPoint.y >= anchor.y ) return true;

    // Construct a path between the anchor and the point to test.
    // Must remain within at least one region at all times.
    // 1. Test if the center of the segment is within a region.
    // 2. Test if intersections only occur at endpoints.
    // --> If both are true, can burrow. If not true, either region ends or other region overlaps.
    // (Overlapping is very unlikely b/c we are using combined cutaways here.)
    const mid = PIXI.Point.midPoint(anchor, testPoint);
    if ( !this.cutaways.some(cutHandler => cutHandler.testPoint(mid)) ) return false;
    const ixFound = this.cutaways.some(cutHandler => {
      const ixs = cutHandler.segmentIntersections(anchor, testPoint);
      return ixs.some(ix => !(testPoint.almostEqual(ix) || anchor.almostEqual(ix)))
    });
    return !ixFound;
  }

  /* ----- NOTE: Flying ----- */

  get flying() { return this.constructor.tokenIsFlying(this.token); }

  /* Flying Options without using pathfinding:
    1. Get walking path.
    - If end equals end of walking path, run anchor shortcut algorithm.
    - If end is above end of walking path and reachable without hitting cutaway, run anchor shortcut algorithm.
    - If end is below, likely (definitely?) unreachable. Run anchor shortcut.
    - Otherwise, go to #2.

    2. Get reverse walking path from end to start.
    - (Create new instance, initialize in reverse, and run. Convert to 3d and then back to 2d in original direction.)
    - Attempt to connect the two paths. If they connect, combine and run anchor shortcut algorithm.
    - Otherwise, go to #3.

    3. End point is above the walking path but does not intersect via walking. Is that possible?
    - Probably not. Either original or reverse walking path should fall down and meet up.
    - But maybe moving through a tile or region does it?
    - Set a warning message to check for this scenario. To try to handle, go to #4.

    4. Find a flight path between the two walking paths.
    - Could try #5.
    - Or, just allow flight straight up. Straight up through a tile or straight up through any region.

    5. More complex version
    - For each original path segment:
    - For each TL and BL corner on reverse path:
      - Try to connect to the original walking path edge.
      - If blocked, try to connect using the BL corner of the blocking region as the swing point.
      - Need only connect each TL corner once.
    */
  constructFlyingPath(a, b, initialize = true) {
    if ( initialize ) this._initialize(a, b);
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);
    let path2d = [];
    try {
      path2d = this._constructWalkingPath(a2d, b2d, "flying");
      this.#verifyPath2d(path2d);

    } catch ( err ) {
      console.error(`constructWalkingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b]; // Give up; return a --> b directly.
    }

    // Can we reach the end point? If the end is above but blocked by a cutaway, try to connect the two.
    path2d = this.#connectFlyingPathToEnd(path2d, a, b, a2d, b2d);

    // Run anchor algorithm locate shortcuts along diagonals.
    try {
      const tmp = this._constructFlyingPath(path2d, b2d);
      this.#verifyPath2d(tmp)
      path2d = tmp;

    } catch ( err ) {
      console.error(`constructFlyingPath ${a} -> ${b}`, path2d);
      console.error(err);
    }

    // Convert back to 3d.
    const path = path2d.map(pt => this.from2d(pt).roundDecimals(1));
    path2d.forEach(pt => pt.release());
    return path;
  }

  #connectFlyingPathToEnd(path2d, a, b, a2d, b2d) {
    a2d ??= this.to2d(a);
    b2d ??= this.to2d(b);

    // Are we already at the endpoint?
    const pathEnd = path2d.at(-1);
    if ( pathEnd.almostEqual(b2d) ) return path2d;

    // Prevents elevation falling back to initial elevation when elevation at destination is higher than initial elevation
    if ( pathEnd.x.almostEqual(b2d.x) && pathEnd.y > b2d.y ) return path2d;

    // Could we get there simply by flying without hitting anything?
    if ( this.#foundFlyingShortcut(pathEnd, b2d) ) {
      path2d.push(b2d);
      return path2d;
    }

    // If the end is above but blocked by a cutaway, try to connect the two.
    // Connect by drawing the reverse path, from finish to start.
    // Requires a separate manager.
    const tm = new this.constructor(this.token);
    tm._initialize(b, a);
    let path2dReverse;
    try {
      path2dReverse = tm.constructWalkingPath(b, a); // Note: 3d coordinates.

      // Convert to be in this path's 2d coordinates.
      path2dReverse = path2dReverse.map(pt => this.to2d(pt));
      path2d = this.#connectPaths(path2d, path2dReverse);
      this.#verifyPath2d(path2d);

    } catch ( err ) {
      console.error(`constructReverseWalkingPath ${b} -> ${a}`, path2dReverse);
      console.error(err);
    }

    return path2d;
  }

  /**
   * Given two paths, determine the first point of connect and return a new path joining the two.
   * The assumption is that the second path is in the opposite line of travel.
   * The new path follows the first path's line of travel.
   * @param {TerrainPath} path
   * @param {TerrainPath} reversePath
   * @returns {TerrainPath} A new array of connected paths or if they don't connect, throw an error.
   *   Will reuse the points in the path in the newly returned array.
   */
  #connectPaths(path, reversePath) {
    // Walk the reverse path, checking against the first path segments.
    const nPath = path.length;
    const nReversePath = reversePath.length;
    let revA = reversePath[0];
    if ( path[0].almostEqual(revA) ) return [path[0]];

    // Brute force, but taking advantage of early skipping.
    for ( let i = 1; i < nReversePath; i += 1 ) {
      const revB = reversePath[i];
      let a = path[0];
      if ( a.almostEqual(revB) ) { const r = reversePath.slice(0, i + 1); r.reverse(); return r; }
      for ( let j = 1; j < nPath; j += 1 ) {
        const b = path[j];
        if ( b.almostEqual(revA) ) { const r = reversePath.slice(0, i); r.reverse(); return [...path.slice(0, j), ...r]; }
        if ( b.almostEqual(revB) ) { const r = reversePath.slice(0, i + 1); r.reverse(); return [...path.slice(0, j), ...r]; }
        if ( revB.x > b.x ) continue;

        if ( foundry.utils.lineSegmentIntersects(revA, revB, a, b) ) {
          const ix = foundry.utils.lineLineIntersection(a, b, revA, revB);
          const r = reversePath.slice(0, i);
          r.reverse();
          return [...path.slice(0, j), _ixToPoint(ix), ...r];
        }
        a = b;
      }
      revA = revB;
    }
    console.error("connectPaths|Unable to connect the two paths!");
    return path;
  }

  /* Can we get there faster by flying?
    Track elevation changes:
    Anchors:
    - When on ground
    - When flying

    Test anchors:
    - When moving up, test if we can get there faster using the anchor position.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor in case the regions connect/overlap.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
  _constructFlyingPath(path, b2d) {
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const anchors = [];
    const MAX_ITER = 10000;
    let nIters = 0;
    let prevWaypoint = path[0];
    const startingHandler = this._nearestSupport(prevWaypoint);
    if ( startingHandler.location === ABOVE || startingHandler.location === GROUND ) anchors.push(0)

    // Add in flying endpoint if present.
    if ( !path.at(-1).almostEqual(b2d) && this._nearestSupport(b2d).location === ABOVE ) {
      if ( this.#foundFlyingShortcut(path.at(-1), b2d) ) path.push(b2d);
    }

    for ( let i = 1, iMax = path.length; i < iMax; i += 1 ) {
      nIters += 1;
      if ( nIters > MAX_ITER ) break;
      const currWaypoint = path[i];

      // GROUND: moving right-to-left.
      // BELOW: moving vertical up (BELOW -> GROUND)
      // ABOVE: moving vertical down (ABOVE -> GROUND)
      const moveType = currWaypoint.x > prevWaypoint.x ? GROUND : currWaypoint.y > prevWaypoint.y ? BELOW : ABOVE;

      // Test anchors.
      // If can get from anchor to waypoint while always within at least one region, can burrow there.
      // Test the current waypoint if moving right-to-left or below-to-ground.
      if ( moveType === GROUND || moveType === BELOW ) {
        for ( const [idx, anchor] of anchors.entries() ) {
          const anchorPt = path[anchor];
          if ( !this.#foundFlyingShortcut(currWaypoint, anchorPt) ) continue;
          const nDeletions = i - anchor - 1; // Delete intermediate waypoints
          path.splice(anchor+1, nDeletions);
          anchors.splice(idx);
          i -= nDeletions; // Reset i to the next waypoint after the deletions.
          iMax = path.length
        }
      }

      // Set new anchors for the previous point.
      switch ( moveType ) {
        case GROUND:                     // prev waypoint is ground and not at right edge.
        case ABOVE: anchors.push(i - 1); // prev waypoint is above (left edge)
      }
    }
    return path;
  }

  #foundFlyingShortcut(testPoint, anchor) {
    // Allow movement vertically up through regions/tiles.
    if ( testPoint.x.almostEqual(anchor.x) && testPoint.y <= anchor.y ) return true;

    // Almost same as #foundBurrowingShortcut
    // Construct a path between the anchor and the point to test.
    // Must not intersect any terrain cutaways.
    // 1. Test if the center of the segment is not within a cutaway.
    // 2. Test if intersections only occur at endpoints.
    // --> If both are true, can fly. If not true, some region intersects
    // (Overlapping is very unlikely b/c we are using combined cutaways here.)
    const mid = PIXI.Point.midPoint(anchor, testPoint);
    if ( this.cutaways.some(cutHandler => cutHandler.testPoint(mid)) ) return false;
    const ixFound = this.cutaways.some(cutHandler => {
      const ixs = cutHandler.segmentIntersections(anchor, testPoint);
      return ixs.some(ix => !(testPoint.almostEqual(ix) || anchor.almostEqual(ix)))
    });
    return !ixFound;
  }

  // ----- NOTE: Secondary methods ----- //

  _nearestSupport(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;

    // If burrowing, always move up.
    // If floating, determine top surface below.
    const floatingHandlers = [];
    const groundHandlers = []
    for ( const cutHandler of this.cutaways ) {
      const type = cutHandler.elevationType(pt2d);
      if ( type & LOCS.BELOW ) return { cutHandler, location: LOCS.BELOW, elevation: cutHandler.elevationUponEntry(pt2d) };
      if ( type & LOCS.GROUND ) groundHandlers.push(cutHandler);
      if ( type & LOCS.ABOVE ) floatingHandlers.push(cutHandler);
    }
    // Undefined to have multiple ground at the same point. Take the first.
    if ( groundHandlers.length ) return { cutHandler: groundHandlers[0], location: LOCS.GROUND, elevation: pt2d.y };

    // Floating. Locate the highest ground.
    let maxElev = Number.NEGATIVE_INFINITY;
    let nextFloor;
    for ( const cutHandler of floatingHandlers ) {
      const elev = cutHandler.elevationUponEntry(pt2d);
      if ( elev > maxElev ) {
        maxElev = elev;
        nextFloor = cutHandler;
      }
    }
    return { cutHandler: nextFloor, location: LOCS.ABOVE, elevation: maxElev };
  }

  /**
   * Find the next supporting edge at or below this point.
   * If no support, moves directly up to the nearest support.
   * @param {PIXI.Point} pt2d
   * @returns {object|null}
   * - @prop {CutawayHandler} cutaway
   * - @prop {Edge2d} edge
   * - @prop {PIXI.Point} ix
   */
  _supportingFloorEdge(pt2d, cutaways, tolerance = 1) {
    cutaways ??= this.cutaways

    using a = PIXI.Point.tmp.set(pt2d.x, pt2d.y + 1e06);
    using b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1e06);

    // Locate the nearest above and below intersections.
    let aboveIx;
    let belowIx;
    for ( const cutaway of cutaways ) {
      for ( const edgeIx of cutaway.iterateValidEdgeIntersections(a, b) ) {
        if ( edgeIx.ix.y > pt2d.y ) { // Above.
          aboveIx ??= edgeIx;
          if ( edgeIx.ix.y < aboveIx.ix.y ) aboveIx = edgeIx;
        }
        else { // Below.
          belowIx ??= edgeIx;
          if ( edgeIx.ix.y > belowIx.ix.y ) belowIx = edgeIx;
         }
      }
    }
    if ( !(aboveIx || belowIx) ) return null;
    if ( !belowIx || (aboveIx && aboveIx.ix.y.almostEqual(pt2d.y, tolerance)) ) return aboveIx;
    return belowIx;
  }

  /**
   * Find the next obstacle along a segment.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {object|null} The matching obstacle or null.
   */
  _closestObstacleAlongSegment(a2d, b2d, obstacles) {
    obstacles ??= this.cutaways
    let minT = 1;
    let closestObstacle = null;
    for ( const cutaway of obstacles ) {
      for ( const edgeIx of cutaway.iterateValidEdgeIntersections(a2d, b2d) ) {
        if ( edgeIx.ix.t0 > minT ) continue;
        if ( edgeIx.ix.t0.almostLessThan(0) ) continue;
        minT = edgeIx.ix.t0;
        closestObstacle = edgeIx;
      }
    }
    return closestObstacle;
  }


  // ----- NOTE: Basic Helper methods ----- //




  // ----- NOTE: Token actions ----- //

  /**
   * Determine if a token is taking a flight action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsWalking(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainWalkActions.has(action);
  }

  /**
   * Determine if a token is taking a flight action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsFlying(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainFlightActions.has(action);
  }

  /**
   * Determine if a token is taking a burrowing action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsBurrowing(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainBurrowActions.has(action);
  }

  // ----- NOTE: Debugging ----- //

  static drawPath(path, drawOpts) {
    Draw.connectPoints(path);
    path.forEach(pt => Draw.point(pt, drawOpts));

    // Draw 2d.
    const start = path.at(0);
    const dist = PIXI.Point.distanceBetween(start, path.at(-1));
    path.forEach(pt => {
      const ptDist = PIXI.Point.distanceBetween(start, pt);
      const t = ptDist / dist;
      pt.t0 = t;
    });
    const cutawayPath = path.map(pt => new PIXI.Point(pt.t0 * 1000, -pt.z));
    for ( let i = 1; i < cutawayPath.length; i += 1 ) Draw.segment({ a: cutawayPath[i - 1], b: cutawayPath[i] }, drawOpts);
    cutawayPath.forEach(pt => Draw.point(pt, drawOpts))
  }
}


/**
 * Manages tests of a cutaway polygon related to movement along the cutaway.
 */
export class CutawayHandler {

  /** @type {CutawayPolygon} */
  cutPoly;

  /** @type {AABB2d} */
  aabb;

  constructor(cutPoly) {
    this.cutPoly = cutPoly;
    this.aabb = AABB2d.fromPolygon(cutPoly);
    this.#buildProfile();
  }

  // ----- NOTE: Top surface profile for the sweep ----- //

  /**
   * Non-vertical, left-to-right edges only. Represents the walkable top surface.
   * Sorted by x to facilitate binary search.
   * Assumes no polygon change after construction.
   * @type {Segment}
   */
  #topEdges;

  /**
   * Non-vertical, left-to-right edges only. Represents the walkable bottom surface.
   * Sorted by x to facilitate binary search.
   * Assumes no polygon change after construction.
   * @type {Segment}
   */
  #bottomEdges;

  /**
   * Non-vertical, right-to-left edges. Represents the solid's underside.
   * Usually a flat base, but built generally in case some other shape requires it.
   * Stores each edge left-to-right and sorted by x (same convention as #topEdges).
   * Typically used to determine if the solid region is floating above the current token position.
   * @type {Segment}
   */

  #buildProfile() {
    const tops = [];
    const bottoms = [];
    for ( const edge of this.cutPoly.iterateEdges() ) {
      if ( edge.a.x.almostEqual(edge.b.x) ) continue; // Vertical side.
      if ( edge.a.x < edge.b.x ) tops.push(edge);
      else bottoms.push(edge.reverse()); // Normalize right-to-left for lookup.
    }
    tops.sort((e1, e2) => e1.a.x - e2.a.x); // Sort low to high by x.
    bottoms.sort((e1, e2) => e1.a.x - e2.a.x);
    this.#topEdges = tops;
    this.#bottomEdges = bottoms;
  }

  /**
   * Elevation of this solid's top surface at x, by linear interpolation along the covering top edges.
   * @param {number} x
   * @returns {number|null} Null if this solid's top surface does not cover x.
   */
  topAt(x) { return CutawayHandler.#elevationAt(this.#topEdges, x); }

  /**
   * Elevation of this solid's bottom surface at x, by linear interpolation along the bottom edges.
   * @param {number} x
   * @returns {number|null} Null if this solid's bottom surface does not cover x.
   */
  bottomAt(x) { return CutawayHandler.#elevationAt(this.#bottomEdges, x); }

  /**
   * Binary search a sorted, left-to-right, non-overlapping edge list for the one covering x, and
   * linearly interpolate its elevation there.
   * @param {Segment[]} edges
   * @param {number} x
   * @returns {number|null}
   */
  static #elevationAt(edges, x) {
    let lo = 0;
    let hi = edges.length - 1;

    // Binary search to locate the correct edge.
    while ( lo <= hi ) {
      const mid = (lo + hi) >> 1; // Average of lo and high, rounded down. Requires positive integers.
      const e = edges[mid];
      if ( x < e.a.x && !x.almostEqual(e.a.x) ) hi = mid - 1;
      else if ( x > e.b.x && !x.almostEqual(e.b.x) ) lo = mid + 1;
      else return e.a.x.almostEqual(e.b.x)
        ? e.a.y
          : e.a.y + ((e.b.y - e.a.y) * (x - e.a.x) / (e.b.x - e.a.x));
    }
    return null;
  }

  /**
   * The x-values of every top-surface vertex, where the top slope can change.
   * @returns {number[]}
   */
  topBreakpoints() {
    const tops = this.#topEdges;
    const n = tops.length;
    const xs = new Array(n * 2);
    for ( let i = 0, j = 0; i < n; i += 1 ) {
      const e = tops[i];
      xs[j++] = e.a.x;
      xs[j++] = e.b.x;
    }
    return xs;
  }

  // ----- NOTE: Bounds testing ----- //

  /**
   * Does this segment intersect (or is inside) the bounding box of this cutaway polygon?
   * @param {PIXI.Point} a2d      Endpoint of segment
   * @param {PIXI.Point} b2d      Other segment endpoint
   * @param {["x", "y"]} [axes]      Axes to test
   * @returns {boolean} True if within the bounding box
   */
  segmentInBounds(a2d, b2d, axes) { return this.aabb.overlapsSegment(a2d, b2d, axes); }

  /**
   * Does this point intersect the bounding box of this cutaway polygon?
   * @param {PIXI.Point} a2d            Point to test
   * @param {["x", "y"]} [axes]       Axes to test
   * @returns {boolean} True if within the bounding box
   */
  pointInBounds(a2d, axes) { return this.aabb.containsPoint(a2d, axes); }

  /**
   * Terrain version of `region.document.testPoint`. Rejects if above or below the cutaway.
   * @param {PIXI.Point} pt2d         Point to test
   * @returns {boolean}
   */
  testPoint(pt2d) {
    if ( !this.pointInBounds(pt2d) ) return false;
    return this.cutPoly.contains(pt2d.x, pt2d.y);
  }

  // ----- NOTE: Elevation and surface testing ----- //

  /**
   * Where is this point relative to this terrain polygon cutaway?
   * @param {PIXI.Point} pt2d         Point to test
   * @returns {ELEVATION_LOCATIONS}
   */
  _elevationTypeAndEntry(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    const VERTICAL = TokenElevationHandler.VERTICAL_LOCATIONS;
    let out = {
      location: LOCS.OUTSIDE,          // Location of the pt2d w/r/t the cutPoly floor.
      floor: Number.NEGATIVE_INFINITY, // Maximum supporting elevation.
      edge: VERTICAL.NONE,   // Whether on a vertical edge.
    };

    if ( !this.aabb.containsPoint(pt2d, ["x"]) ) return out;

    // To avoid inconsistencies between containment and intersections, check intersections first.
    // E.g., a point may be very close to an intersection but technically not contained in the shape.

    // Check if point is exactly at a left edge or right edge.
//     const verticalTangentLoc = this.#verticalTangentLocation(pt2d, this.cutPoly);
//     if ( verticalTangentLoc !== LOCS.OUTSIDE ) {
//       if ( verticalTangentLoc & LOCS.BELOW ) return LOCS.BELOW;
//       if ( verticalTangentLoc & LOCS.ABOVE ) return LOCS.ABOVE;
//       return LOCS.GROUND;
//     }
    const verticalIxs = polygonVerticalTangentPoints(pt2d.x, this.cutPoly);

    // Get all the intersections of the vertical line, minus tangents.
    // First ix is in. Cannot just shoelace b/c we might be on a vertical edge.
    const ixs = this.cutPoly.lineIntersections(pt2d, PIXI.Point.tmp.set(pt2d.x, pt2d.y + 1)); // Should not need to exclude tangents b/c regions and tiles should not create them for verticals here.
    const numIxs = ixs.length;
    if ( !numIxs ) return out;

    // If we are lower than the lowest intersection, consider as outside.
    ixs.sort((a, b) => a.y - b.y); // Bottom to top in elevation.
    let a = ixs[0];
    if ( pt2d.y < a.y && !pt2d.y.almostEqual(a.y) ) return out;

    // Check each segment between intersections in turn.
    let midPoint = PIXI.Point.tmp;
    for ( let i = 1; i < numIxs; i += 1 ) {
      const b = ixs[i];
      if ( a.y.almostEqual(b.y) ) continue; // Duplicate intersection points.

      // Either we are at a vertical edge, at an outside gap between two edges, or at an inside portion between two edges.
      const vertical = this.#isVerticalEdge(verticalIxs, a, b); // Check if segment is left or right vertical.
      switch ( vertical ) {
        case VERTICAL.LEFT: {
          out.floor = b.y;
          out.edge = VERTICAL.LEFT;
          if ( !pt2d.y.almostLessThan(b.y) ) break; // Have not gotten to the point yet.
          if ( pt2d.y.almostEqual(b.y) ) out.location ||= LOCS.GROUND;
          else out.location = LOCS.BELOW;
          break;
        }
        case VERTICAL.RIGHT: { // Treat as outside the cutaway. No change to floor.
          out.edge = VERTICAL.RIGHT;
          if ( !pt2d.yalmostLessThan(b.y) ) break; // Have not gotten to the point yet.
          if ( out.location ) return out; // Found the floor and reached an outside segment.
          if ( i ) out.location = LOCS.ABOVE;
          break;
        }
        case VERTICAL.NONE: {
          out.edge = VERTICAL.NONE;
          // Are we inside or outside? Test the midpoint between a and b.
          PIXI.Point.midPoint(a, b, midPoint);
          const inside = this.cutPoly.contains(midPoint.x, midPoint.y);
          if ( inside ) out.floor = b.y;
          if ( !pt2d.y.almostLessThan(b.y) ) break; // Have not gotten to the point yet.
          if ( out.location && !inside ) return out; // Found the floor and reached an outside segment.

          if ( pt2d.y.almostEqual(b.y) ) {
            if ( inside ) out.location ||= LOCS.GROUND;
            else out.location = LOCS.BELOW;

          } else {
            if ( inside ) out.location = LOCS.BELOW;
            else {
              // Outside, so the intersection below was the last floor.
              out.location = LOCS.ABOVE;
              if ( !out.location ) out.floor = a.y;
              return out;
            }
          }
          break;
        }
      }
      a = b;
    }
    if ( isFinite(out.floor) ) out.location ||= LOCS.ABOVE;
    return out; // Above the last segment's ground.
  }

  #isVerticalEdge(verticalIxs, a, b) {
    const VERTICAL = TokenElevationHandler.VERTICAL_LOCATIONS;
    for ( let i = 1, iMax = verticalIxs.length; i < iMax; i += 2 ) {
      const aV = verticalIxs[0];
      const bV = verticalIxs[1];
      if ( a.almostEqual(aV) && b.almostEqual(bV)
        || b.almostEqual(aV) && a.almostEqual(bV) ) return aV.y < bV.y ? VERTICAL.LEFT : VERTICAL.RIGHT;
    }
    return VERTICAL.NONE;
  }

  /**
   * Where is this point relative to this terrain polygon cutaway?
   * @param {PIXI.Point} pt2d         Point to test
   * @returns {ELEVATION_LOCATIONS}
   */
  elevationType(pt2d) { return this._elevationTypeAndEntry(pt2d).location; }

  /**
   * Determine the elevation upon moving into this cutaway polygon.
   * If the point is above, fall to the next surface.
   * If point is below, move up to next surface.
   * The provided location is not tested for whether it is within the region.
   * @param {PIXI.Point} a   Position immediately upon entry
   * @returns {number} The elevation of the plateau or the ramp at this location
   *   Return Number.NEGATIVE_INFINITY if it would be outside.
   */
  elevationUponEntry(pt2d) { return this._elevationTypeAndEntry(pt2d).floor; }

  // ----- NOTE: Intersections ----- //

   /**
   * Obtain the intersection points for a 2d segment against this cut polygon.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  segmentIntersections(a2d, b2d, opts) { return this.cutPoly.segmentIntersections(a2d, b2d, opts); }
}


/**
 * Test if a polygon has a vertical edge that overlaps (is tangent) to a vertical line.
 * @param {number} x              The x value for the tangent line
 * @param {PIXI.Polygon} poly     The polygon to test
 * @returns {PIXI.Point[]} Intersection points (the edge endpoints) in order encountered in the edge(s).
 */
function polygonVerticalTangentPoints(x, poly) {
  const ixs = [];
  for ( const edge of poly.iterateEdges() ) {
    if ( !(edge.a.x === edge.b.x && edge.a.x.almostEqual(x)) ) continue;
    ixs.push(edge.a, edge.b);
  }
  return ixs;
}


// ----- NOTE: Helper functions ----- //

function _ixToPoint(ix) {
  const pt = PIXI.Point.tmp.set(ix.x, ix.y);
  pt.t0 = ix.t0;
  return pt;
}
