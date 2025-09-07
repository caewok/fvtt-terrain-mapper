/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import {
  elevatedRegions,
  elevatedTiles } from "./util.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { cutaway, almostGreaterThan, almostLessThan, almostBetween, gridUnitsToPixels } from "./geometry/util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";
import { Draw } from "./geometry/Draw.js";
import { AABB2d } from "./geometry/AABB.js";


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

  // ----- NOTE: Static Getters ----- //

  /** @type {Region[]} */
  static get elevatedRegions() { return elevatedRegions(); }

  /** @type {Tile[]} */
  static get elevatedTiles() { return elevatedTiles(); }

  // ----- NOTE: Static methods ----- //

  /**
   * Filter elevated regions by a 2d segment.
   * @param {Point} start           Start of the path
   * @param {Point} end             End of the path
   * @param {Region[]} [regions]      Regions to consider
   * @returns {Region[]} Elevated regions that may intersect.
   */
  static filterElevatedRegionsByXYSegment(start, end, regions) {
    return elevatedRegions(regions).filter(region => region[MODULE_ID].segmentInBounds(start, end, ["x", "y"]));
  }

  /**
   * Filter elevated tiles by a 2d segment.
   * @param {Point} start           Start of the path
   * @param {Point} end             End of the path
   * @param {Tile[]} [tiles]        Tiles to consider
   * @returns {Tile[]} Elevated tiles that may intersect.
   */
  static filterElevatedTilesByXYSegment(start, end, tiles) {
    // TODO: Filter by bounds, using full z.
    return elevatedTiles(tiles).filter(tile => tile.bounds.lineSegmentIntersects(start, end, { inside: true }));
  }


  // ----- NOTE: Constructor ----- //

  regions = [];

  tiles = [];

  token;

  regionCutaways = new WeakMap();

  combinedCutaways = [];

  constructor(token) {
    this.token = token;
  }

  #start = new ElevatedPoint();

  get start() { return this.#start.clone(); }

  #end = new ElevatedPoint();

  get end() { return this.#end.clone(); }

  initialize(start, end) {
    // Ensure that the cutaway polygons extend beyond the start and end point along x/y axes.
    // This avoids issues where the path artificially moves down or up b/c it is at the cutoff.
    const startXY = PIXI.Point.fromObject(start);
    const endXY = PIXI.Point.fromObject(end);
    if ( startXY.equals(endXY) ) startXY.x += 1;  // Arbitrarily extend so there is a cutaway x/y surface.
    const distXY = PIXI.Point.distanceBetween(startXY, endXY)
    startXY.towardsPoint(endXY, distXY + 1, this.#end);
    endXY.towardsPoint(startXY, distXY + 1, this.#start);
    this.#start.z = start.z ?? (start.elevation ? gridUnitsToPixels(start.elevation) : 0);
    this.#end.z = end.z ?? (end.elevation ? gridUnitsToPixels(end.elevation) : 0);

    this.regions = this.constructor.filterElevatedRegionsByXYSegment(this.#start, this.#end);
    this.tiles = this.constructor.filterElevatedTilesByXYSegment(this.#start, this.#end);

    this.regionCutaways = new WeakMap();
    this.regions.forEach(r => this.regionCutaways.set(r, new CutawayRegion(this.#start, this.#end, r)));
    this.regionCutaways.set(canvas.scene, new CutawayRegion(this.#start, this.#end, canvas.scene));

    this.combinedCutaways = [this.regionCutaways.get(canvas.scene)];
    if ( this.regions.length ) {
      const polys = [];
      [canvas.scene, ...this.regions].forEach(r => {
        const regionHandler = this.regionCutaways.get(r);
        regionHandler.cutawayHandlers.forEach(h => polys.push(h.cutPoly));
      });

      const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;

      // Have to reverse the polygons for Clipper to not treat as holes.
      polys.forEach(poly => poly.reverseOrientation())

      this.combinedCutaways = ClipperPaths.fromPolygons(polys)
        .combine()
        .clean()
        .toPolygons()
        .map(poly => {
          // Don't need to reverse here.
          const cutPoly = CutawayPolygon.fromCutawayPoints(poly.points, this.#start, this.#end);
          return new CutawayHandler(cutPoly);
        });

      // Revert back the original polygons.
      polys.forEach(poly => poly.reverseOrientation())
    }
  }


  // ----- NOTE: Primary methods ----- //

  constructPath(a, b, { flying, burrowing, walking } = {}) {
    // if ( a.equals(b) ) return [a, b];
    flying ??= this.flying;
    burrowing ??= this.burrowing;
    walking ??= this.walking;

    // Simple case: Token unbound by terrain; can fly and burrow!
    if ( flying && burrowing || !(flying || burrowing || walking) ) {
      return [a, b];

      /*
      this.initialize(start, end);
      if ( this.canEndBelow ) return [start, end];
      const endType = this.elevationType(end, this.token, this.regions, this.tiles);
      if ( endType !== this.constructor.ELEVATION_LOCATIONS.BELOW ) return [start, end];
      const support = this.nearestSupport(end, true);
      return [start, ElevatedPoint.fromLocationWithElevation(end, support.elevation)];
      */
    }

    if ( burrowing ) return this.constructBurrowingPath(a, b);
    if ( flying ) return this.constructFlyingPath(a, b);
    return this.constructWalkingPath(a, b);
  }

  to2d(value) { return cutaway.to2d(value, this.#start, this.#end); }

  from2d(value) { return cutaway.from2d(value, this.#start, this.#end); }


  #verifyPath2d(path2d) {
    if ( !path2d.length ) throw Error("Path is empty.");
    if ( path2d.length > 9999 ) throw Error("Path is too long.");
    if ( path2d.some(pt => isNaN(pt.x) || isNaN(pt.y)) ) throw Error("Path has NaN.");
    if ( path2d.some(pt => pt.y > 100000 || pt.y < -100000) ) throw Error("Path elevation error");
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
  constructWalkingPath(a, b) {
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);
    let path2d = [];
    try {
      path2d = this._constructWalkingPath(a2d, b2d);
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructWalkingPath ${a} -> ${b}`, path);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }
    const path = path2d.map(pt => this.from2d(pt));
    path2d.forEach(pt => pt.release());
    return path;
  }


  /**
   * Use Clipper to join regions together.
   * This simplifies the walking algorithm.
   * For floating regions or tiles, still might fall from one to another, so must account for that.
   */
  _constructWalkingPath(a2d, b2d) {
    const { ABOVE, BELOW } = this.constructor.ELEVATION_LOCATIONS;

    // Multiple polygons or polygons + tiles means vertical moves down can hit a tile or drop to another polygon.
    // Note that other than for tiles, there are no intersecting polygons (combined by Clipper already).
    let currWaypoint = a2d;
    const waypoints = [a2d];

    const MAX_ITER = 10000;
    let nIters = 0;
    const finished = () => almostGreaterThan(currWaypoint.x, b2d.x); // waypoint ≥ end
    do {
      nIters += 1;

      // Determine current location.
      let { cutHandler, location, elevation } = this._nearestSupport(currWaypoint);

      // Move up or down as needed.
      // TODO: Check for tiles. Should this also be done in _nearestSupport?
        // Poly intersections already checked.
      if ( location === ABOVE || location === BELOW ) {
        const nextPt = PIXI.Point.tmp.set(currWaypoint.x, elevation);
        if ( currWaypoint.y > nextPt.y ) {
          // Check for tiles.
        }
        currWaypoint = nextPt;
        waypoints.push(currWaypoint);
      }

      // Walk surface, checking for movement down for tiles.
      for ( const v of cutHandler.surfaceWalk(currWaypoint) ) {
        if ( currWaypoint.x === v.x && currWaypoint.y < v.y ) {
          // Check for tiles.
        }
        currWaypoint = v;
        waypoints.push(v);
      }
    } while ( !finished() && nIters < MAX_ITER );
    this.#adjustEndpoint(waypoints, b2d);
    return waypoints;
  }

  #adjustEndpoint(waypoints, end2d) {
    // Confirm where the endpoint is located in the final edge.
    if ( waypoints.length < 2 ) return waypoints;
    const a = waypoints.at(-2);
    const b = waypoints.at(-1);
    if ( a.almostEqual(b) ) throw Error("_constructWalkingPath surfaceWalk returned duplicate end waypoints.");

    // Determine where end2d lies in relation to the last move segment.
    const newEnd = foundry.utils.closestPointToSegment(end2d, a, b);
    if ( a.almostEqual(newEnd) ) waypoints.pop(); // Keep a, lose b.
    else if ( !b.almostEqual(newEnd) ) {
      waypoints.pop(); // Keep a, lose b.
      waypoints.push(PIXI.Point.fromObject(newEnd));
    } // Else b is almostEqual to newEnd, in which case we are fine.
    return waypoints;
  }

  /* ----- NOTE: Burrowing ----- */

  get burrowing() { return this.constructor.tokenIsBurrowing(this.token); }

  constructBurrowingPath(a, b) {
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);
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

    try {
      path2d = this._constructBurrowingPath(path2d, b2d);
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructBurrowingPath ${a} -> ${b}`, path);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }
    const path = path2d.map(pt => this.from2d(pt));
    path2d.forEach(pt => pt.release());
    return path;
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
    // Construct a path between the anchor and the point to test.
    // Must remain within at least one region at all times.
    // 1. Test if the center of the segment is within a region.
    // 2. Test if intersections only occur at endpoints.
    // --> If both are true, can burrow. If not true, either region ends or other region overlaps.
    // (Overlapping is very unlikely b/c we are using combined cutaways here.)
    const mid = PIXI.Point.midPoint(anchor, testPoint);
    if ( !this.combinedCutaways.some(cutHandler => cutHandler.testPoint(mid)) ) return false;
    const ixFound = this.combinedCutaways.some(cutHandler => {
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
  constructFlyingPath(a, b) {
    const a2d = this.to2d(a);
    const b2d = this.to2d(b);
    let path2d = [];
    try {
      path2d = this._constructWalkingPath(a2d, b2d);
      this.#verifyPath2d(path2d);

    } catch ( err ) {
      console.error(`constructWalkingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }

    // Can we reach the end point? If the end is above but blocked by a cutaway, try to connect the two.
    const pathEnd = path2d.at(-1);
    const requiresConnection = !pathEnd.y.almostEqual(b2d.y) && b2d.y > pathEnd.y && !this.#foundFlyingShortcut(pathEnd, b2d);
    if ( requiresConnection ) {
      // Connect by drawing the reverse path, from finish to start.
      // Requires a separate manager.
      const tm = new this.constructor(this.token);
      tm.initialize(b, a);
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
    }

    // Run anchor algorithm to see if we can fly to diagonals
    try {
      path2d = this._constructFlyingPath(path2d, b2d);
      this.#verifyPath2d(path2d)

    } catch ( err ) {
      console.error(`constructFlyingPath ${a} -> ${b}`, path2d);
      console.error(err);
      path2d.forEach(pt => pt.release());
      return [a, b];
    }
    const path = path2d.map(pt => this.from2d(pt));
    path2d.forEach(pt => pt.release());
    return path;
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
    // TODO: Should this error be removed and instead just return the first path?
    throw new Error("connectPaths|Unable to connect the two paths!");
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
    // Almost same as #foundBurrowingShortcut
    // Construct a path between the anchor and the point to test.
    // Must not intersect any terrain cutaways.
    // 1. Test if the center of the segment is not within a cutaway.
    // 2. Test if intersections only occur at endpoints.
    // --> If both are true, can fly. If not true, some region intersects
    // (Overlapping is very unlikely b/c we are using combined cutaways here.)
    const mid = PIXI.Point.midPoint(anchor, testPoint);
    if ( this.combinedCutaways.some(cutHandler => cutHandler.testPoint(mid)) ) return false;
    const ixFound = this.combinedCutaways.some(cutHandler => {
      const ixs = cutHandler.segmentIntersections(anchor, testPoint);
      return ixs.some(ix => !(testPoint.almostEqual(ix) || anchor.almostEqual(ix)))
    });
    return !ixFound;
  }

  // ----- NOTE: Secondary methods ----- //

  _nearestSupport(pt2d, excludeHandler) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;

    // If burrowing, always move up.
    // If floating, determine top surface below.
    const floatingHandlers = [];
    const groundHandlers = []
    for ( const cutHandler of this.combinedCutaways ) {
      if ( cutHandler === excludeHandler ) continue;
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

// ----- NOTE: Cutaway region class ----- //

/* Region cutaway characteristics.
Segment a|b cuts through 1+ 3d region polygons to form a 2d space.

In this coordinate system:
- x goes from 0 to PIXI.Point.distanceSquaredBetween(a, b)
- y is pixel elevation and north (up) increases y. (opposite of Foundry)
- All cutaway polygons should be oriented clockwise, so you move from right to left along top of polygon.
- Holes are not needed (regions are filled), although floating polygons can create empty space between regions in the y axis.

- All region cutaways (currently) have vertical sides.
- A point on the left vertical should be considered ground if at the top of the polygon, otherwise burrowing.
  - Tangent ix with left vertical line should return top and bottom of region
- A point on the right vertical should be considered flying w/r/t that region. Region below (e.g., scene) would be ground.
  - Tangent ix with right vertical line should return top and bottom of region
*/




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
          if ( !almostLessThan(pt2d.y, b.y) ) break; // Have not gotten to the point yet.
          if ( pt2d.y.almostEqual(b.y) ) out.location ||= LOCS.GROUND;
          else out.location = LOCS.BELOW;
          break;
        }
        case VERTICAL.RIGHT: { // Treat as outside the cutaway. No change to floor.
          if ( !almostLessThan(pt2d.y, b.y) ) break; // Have not gotten to the point yet.
          if ( out.location ) return out; // Found the floor and reached an outside segment.
          if ( i ) out.location = LOCS.ABOVE;
          break;
        }
        case VERTICAL.NONE: {
          // Are we inside or outside? Test the midpoint between a and b.
          PIXI.Point.midPoint(a, b, midPoint);
          const inside = this.cutPoly.contains(midPoint.x, midPoint.y);
          if ( inside ) out.floor = b.y;
          if ( !almostLessThan(pt2d.y, b.y) ) break; // Have not gotten to the point yet.
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


  /**
   * Walk the surface starting at a2d and going to b2d.
   * If path moves from right to left: (walking "upside-down")
   * - If prior move was up, continue move up through region to surface.
   * - Otherwise stop (should be prior move down).
   * @param {PIXI.Point} a2d      A point on or very close to an edge
   * @param {PIXI.Point} b2d      A second point later than the first in the x direction.
   *   If an endpoint intersects b2d, that point is returned. Otherwise, stops when edge intersects b2d.x
   * @returns {PIXI.Point[]} Points on the top of the cutaway polygon for the region, or representing the vertical left/right edges
   */
  surfaceWalk(a2d, b2d) {
    a2d ??= PIXI.Point.tmp(0, 0);
    b2d ??= PIXI.Point.tmp.set(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);

    // Either a2d intersects an edge or a vertical edge contains a2d.
    // (Cannot use iterator in multiple for loops, so iterate manually)
    const iter0 = this.cutPoly.iterateEdges({ close: true });
    const pts = [];
    let priorMoveUp = false;
    let edge;
    while ( (edge = iter0.next().value) ) {
      const isStart = this.#isStartingEdge(edge, a2d);
      if ( isStart ) { pts.push(a2d); break; }
      if ( isStart === null ) { // Moving backwards. Change the start to the surface.
        const elev = this.elevationUponEntry(a2d);
        return this.surfaceWalk(PIXI.Point.tmp.set(a2d.x, elev), b2d);
      }
      priorMoveUp = edge.A.y <= edge.B.y;
    }
    if ( !pts.length ) return [];

    while ( (edge = iter0.next().value) ) {
      const isEnd = this.#isEndingEdge(edge, b2d);
      if ( isEnd ) {
        if ( !isEnd.length && priorMoveUp ) { // Moving backwards; cut through to top.
          const elev = this.elevationUponEntry(a2d);
          const newPts = this.surfaceWalk(PIXI.Point.tmp.set(a2d.x, elev), b2d);
          pts.push(...newPts);
          return pts;
        }
        pts.push(...isEnd); return pts;
      }
      pts.push(edge.A); // B will become A next iteration.
      priorMoveUp = edge.A.y <= edge.B.y;
    }

    const iter1 = this.cutPoly.iterateEdges({ close: true });
    while ( (edge = iter1.next().value) ) {
      const isEnd = this.#isEndingEdge(edge, b2d);
      if ( isEnd ) {
        if ( !isEnd.length && priorMoveUp ) { // Moving backwards; cut through to top.
          const elev = this.elevationUponEntry(a2d);
          const newPts = this.surfaceWalk(PIXI.Point.tmp.set(a2d.x, elev), b2d);
          pts.push(...newPts);
          return pts;
        }
        pts.push(...isEnd); return pts;
      }
      pts.push(edge.A); // B will become A next iteration.
      priorMoveUp = edge.A.y <= edge.B.y;
    }
    return pts;
  }

  /**
   * Does this edge contain a2d?
   * @param {Segment} edge
   * @param {CutawayPoint} a2d
   * @returns {boolean|null} Null if moving backwards at the intersection point with a2d.
   */
  #isStartingEdge(edge, a2d) {
    if ( edge.A.almostEqual(a2d) ) return true;
    if ( edge.B.almostEqual(a2d) ) return false;

    // Test for vertical A|B.
    if ( edge.A.x === edge.B.x ) return almostBetween(a2d.x, edge.A.x, edge.B.x);

    // Test for ix with non-vertical A|B.
    const a1 = PIXI.Point.tmp.set(a2d.x, a2d.y + 1);
    const a2 = PIXI.Point.tmp.set(a2d.x, a2d.y - 1);
    if ( foundry.utils.lineSegmentIntersects(edge.A, edge.B, a1, a2) ) {
      a1.release();
      a2.release();
      if ( edge.A.x > edge.B.x ) return null; // Moving backwards.
      return true;
    }
    a1.release();
    a2.release();
    return false;
  }

  /**
   * Does this edge pass b2d x value?
   * @param {Segment} edge
   * @param {CutawayPoint} b2d
   * @returns {PIXI.Point[]|null} Points to add if necessary; null if not at the ending edge.
   */
  #isEndingEdge(edge, b2d) {
    if ( edge.A.x > edge.B.x ) return []; // Moving backwards, so nothing to add but need to cancel the move.
    if ( edge.B.x < b2d.x ) return null;

    // Test for vertical A|B.
    if ( edge.A.x === edge.B.x && edge.A.x.almostEqual(b2d.x) ) {
      // Moving up or down.
      if ( b2d.y.almostEqual(edge.A.y) ) return [edge.A];
      if ( almostBetween(b2d.y, edge.A.y, edge.B.y) ) return [edge.A, b2d];
      return [edge.A, edge.B];
    }

    // Test for ix in non-vertical A|B.
    if ( almostBetween(b2d.x, edge.A.x, edge.B.x) ) {
      if ( edge.A.x.almostEqual(b2d.x) ) return [edge.A];

      const a1 = PIXI.Point.tmp.set(b2d.x, b2d.y + 1);
      const a2 = PIXI.Point.tmp.set(b2d.x, b2d.y - 1);
      const ix = foundry.utils.lineLineIntersection(edge.A, edge.B, a1, a2);
      a1.release();
      a2.release();
      return [edge.A, _ixToPoint(ix)];
    }
    return null;
  }

  /**
   * Does a 2d segment definitely intersect this cut polygon?
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {boolean}
   */
  lineSegmentIntersects(a2d, b2d) { return this.cutPoly.lineSegmentIntersects(a2d, b2d); }

  /**
   * Does a 2d segment cross into this cut polygon?
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {boolean}
   */
  lineSegmentCrosses(a2d, b2d, opts) { return this.cutPoly.lineSegmentCrosses(a2d, b2d, opts); }

  /**
   * Obtain the intersection points for a 2d segment against this cut polygon.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  segmentIntersections(a2d, b2d, opts) { return this.cutPoly.segmentIntersections(a2d, b2d, opts); }

  /**
   * Obtain the intersection points for a line against this cut polygon.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  lineIntersections(a2d, b2d, opts) { return this.cutPoly.lineIntersections(a2d, b2d, opts); }

  /* ----- NOTE: Debugging ----- */

  /**
   * Draw a representation of the cutaway
   */
  draw(opts) {
    Draw.connectPoints([...this.cutPoly.iteratePoints()].map(pt => new PIXI.Point(Math.sqrt(pt.x), -pt.y)), opts);
  }
}

/**
 * Manages tests of cutaway polygon uncombined, from a region.
 * The difference here is that uncombined cutaway is guaranteed to start at TL; will be a simpler shape.
 * TODO: Are there any useful shortcuts? Do we care?
 */
class UncombinedCutawayHandler extends CutawayHandler {

}

/**
 * Manages tests of cutaway polygons representing a region.
 */
class CutawayRegion {
  /** @type {AABB2d} */
  regionAABB = new AABB2d();

  /** @type {UncombinedCutawayHandler} */
  cutawayHandlers = [];

  /** @type {RegionElevationHandler} */
  regionHandler;

  /** @type {Region} */
  get region() { return this.regionHandler.regionHandler; }

  constructor(start, end, region) {
    this.regionHandler = region[MODULE_ID];
    const cutPolys = this.regionHandler._cutaway(start, end); // TODO: Ensure correct orientation.
    this.cutawayHandlers = cutPolys.map(cp => new UncombinedCutawayHandler(cp));
    AABB2d.union(this.cutawayHandlers.map(h => h.aabb), this.regionAABB);
  }

  // ----- NOTE: Bounds testing ----- //

  /**
   * Does this segment intersect the bounding box of 1 or more region shapes?
   * @param {PIXI.Point} a2d      Endpoint of segment
   * @param {PIXI.Point} b2d      Other segment endpoint
   * @param {["x", "y"]} [axes]      Axes to test
   * @returns {boolean} True if within the bounding box
   */
  segmentInBounds(a2d, b2d, axes) {
    if ( !this.regionAABB.overlapsSegment(a2d, b2d, axes) ) return false;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      if ( cutawayHandler.segmentInBounds(a2d, b2d, axes) ) return true;
    }
    return false;
  }

  /**
   * Does this point intersect the bounding box of 1 or more region shapes?
   * @param {PIXI.Point} a            Point to test
   * @param {["x", "y"]} [axes]       Axes to test
   * @returns {boolean} True if within the bounding box
   */
  pointInBounds(a2d, axes) {
    if ( !this.regionAABB.containsPoint(a2d, axes) ) return false;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      if ( cutawayHandler.pointInBounds(a2d, axes) ) return true;
    }
    return false;
  }

  /**
   * Terrain version of `region.document.testPoint`. Rejects if above or below the terrain.
   * @param {PIXI.Point} pt2d         Point to test
   * @returns {boolean}
   */
  testPoint(pt2d) {
    if ( !this.pointInBounds(pt2d) ) return false;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      if ( cutawayHandler.testPoint(pt2d) ) return true;
    }
    return false;
  }

  // ----- NOTE: Elevation and surface testing ----- //

  /**
   * Where is this point relative to the terrain?
   * @param {PIXI.Point} pt2d        Point to test
   * @returns {ELEVATION_LOCATIONS}
   */
  elevationType(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;

    // For region cutaways, the sides are always vertical. So can test bounds for x.
    if ( !this.regionAABB.containsPoint(pt2d, ["x"]) ) return LOCS.OUTSIDE;

    // Prioritize burrowing.
    let grounded = false;
    let flying = false;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      const type = cutawayHandler.elevationType(pt2d);
      switch ( type ) {
        case LOCS.OUTSIDE: continue;
        case LOCS.BURROWING: return LOCS.BURROWING;
        case LOCS.GROUND: grounded ||= true; break;
        case LOCS.FLYING: flying ||= true; break;
      }
    }
    if ( grounded ) return LOCS.GROUND;
    if ( flying ) return LOCS.FLYING;
    return LOCS.OUTSIDE;
  }

  /**
   * Determine the elevation upon moving into this region.
   * The provided location is not tested for whether it is within the region.
   * @param {PIXI.Point} a   Position immediately upon entry
   * @returns {number} The elevation of the plateau or the ramp at this location
   */
  elevationUponEntry(pt2d) {
    const xAxis = ["x"]
    if ( !this.regionAABB.containsPoint(pt2d, xAxis) ) return Number.NEGATIVE_INFINITY;
    if ( !this.regionHandler.isRamp ) return this.regionHandler.isElevated ? this.regionHandler.plateauElevation : this.region.elevationE.top;

    const b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1);
    let maxElev = Number.NEGATIVE_INFINITY;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      if ( !cutawayHandler.pointInBounds(pt2d, xAxis) ) continue;

      // Point could be exactly at the left edge or the right edge.
      // (We know there is only one vertical edge for a given x here and thus always 0 or 2 points returned.)
      const verticalIxs = polygonVerticalTangentPoints(pt2d.x, cutawayHandler.cutPoly);
      if ( verticalIxs.length ) return verticalIxs[1].y // Either left side, moving up. or right side, moving down.

      // Intersect the cut polygon with a vertical line to determine the maximum location at that point.
      const ixs = cutawayHandler.lineIntersections(pt2d, b);
      for ( const ix of ixs ) maxElev = Math.max(maxElev, ix.y);
    }
    return maxElev;
  }

  /**
   * Walk the surface starting at a2d and going to b2d.
   * Stop if the path moves from right to left. (Would be walking "upside-down".)
   * Choose the first cutaway that has the a2d point.
   * @param {PIXI.Point} a2d      A point on or very close to an edge
   * @param {PIXI.Point} b2d      A second point later than the first in the x direction.
   *   If an endpoint intersects b2d, that point is returned. Otherwise, stops when edge intersects b2d.x
   * @returns {PIXI.Point[]} Points on the top of the cutaway polygon for the region, or representing the vertical left/right edges
   */
   surfaceWalk(a2d, b2d) {
     for ( const cutawayHandler of this.cutawayHandlers ) {
       const pts = cutawayHandler.surfaceWalk(a2d, b2d);
       if ( pts.length ) return pts;
     }
     return [];
   }


  /**
   * Does a 2d segment definitely intersect this region?
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {boolean}
   */
  lineSegmentIntersects(a2d, b2d) {
    for ( const cutawayHandler of this.cutawayHandlers ) {
      if ( cutawayHandler.lineSegmentIntersects(a2d, b2d) ) return true;
    }
    return false;
  }

  /**
   * Does a 2d segment cross into this region?
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {boolean}
   */
  lineSegmentCrosses(a2d, b2d, opts) {
    for ( const cutawayHandler of this.cutawayHandler ) {
      if ( cutawayHandler.lineSegmentCrosses(a2d, b2d, opts) ) return true;
    }
    return false;
  }

  /**
   * Obtain the intersection points for a 2d segment against this region.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  segmentIntersections(a2d, b2d/*, { inside = true } = {}*/) {
    const ixs = [];
    //a2d.t0 = 0;
    //b2d.t0 = 1;
    for ( const cutawayHandler of this.cutawayHandlers ) {
      ixs.push(...cutawayHandler.segmentIntersections(a2d, b2d));
    }
    return ixs;
  }

  /**
   * Obtain the intersection points for a line against this cut polygon.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  lineIntersections(a2d, b2d) {
    const ixs = [];
    for ( const cutawayHandler of this.cutawayHandler ) {
      ixs.push(...cutawayHandler.lineIntersections(a2d, b2d));
    }
    return ixs;
  }
}

/**
 * Test if a polygon has a vertical edge that overlaps (is tangent) to a vertical line.
 * @param {number} x              The x value for the tangent line
 * @param {PIXI.Polygon} poly     The polygon to test
 * @returns {PIXI.Point[]} Intersection points (the edge endpoints) in order encountered in the edge(s).
 */
function polygonVerticalTangentPoints(x, poly) {
  const ixs = [];
  for ( const edge of poly.pixiEdges() ) {
    if ( !(edge.A.x === edge.B.x && edge.A.x.almostEqual(x)) ) continue;
    ixs.push(edge.A, edge.B);
  }
  return ixs;
}


// ----- NOTE: Helper functions ----- //

function _ixToPoint(ix) {
  const pt = PIXI.Point.tmp.set(ix.x, ix.y);
  pt.t0 = ix.t0;
  return pt;
}
