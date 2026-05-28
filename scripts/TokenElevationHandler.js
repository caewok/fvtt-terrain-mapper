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
import { cutaway, almostLessThan, almostBetween, gridUnitsToPixels } from "./geometry/util.js";
import { Draw } from "./geometry/Draw.js";
import { AABB2d } from "./geometry/AABB.js";
import { PriorityQueue } from "./geometry/PriorityQueue.js";

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

  combinedCutaways = [];

  constructor(token) {
    this.token = token;
  }

  start = new ElevatedPoint();

  end = new ElevatedPoint();


  initialize(_start, _end) {
    console.warn("TokenElevationHandler|initialize is deprecated.");
  }

  _initialize(start, end) {
    // Ensure that the cutaway polygons extend beyond the start and end point along x/y axes.
    // This avoids issues where the path artificially moves down or up b/c it is at the cutoff.
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

    this.regions = this.constructor.filterElevatedRegionsByXYSegment(this.start, this.end);
    this.tiles = this.constructor.filterElevatedTilesByXYSegment(this.start, this.end);
    this.combinedCutaways = [canvas.scene, ...this.regions, ...this.tiles]
      .flatMap(obj => obj[MODULE_ID]._cutaway(this.start, this.end, this.token))
      .map(cutPoly => new CutawayHandler(cutPoly));
  }


  // ----- NOTE: Primary methods ----- //

  constructPath(a, b, { flying, burrowing, walking, initialize = true } = {}) {
    if ( a.equals(b) ) return [a];
    a.roundDecimals(a);
    b.roundDecimals(b);

    flying ??= this.flying;
    burrowing ??= this.burrowing;
    walking ??= this.walking;

    // Simple case: Token unbound by terrain; can fly and burrow!
    if ( flying && burrowing || !(flying || burrowing || walking) ) return [a, b];

    // Vertical-only move.
    if ( a.x.almostEqual(b.x) && a.y.almostEqual(b.y) ) return this.verticalOnlyMove(a, b.z, { flying, walking, burrowing, initialize });

    if ( burrowing ) return this.constructBurrowingPath(a, b, initialize);
    if ( flying ) return this.constructFlyingPath(a, b, initialize);
    return this.constructWalkingPath(a, b, initialize);
  }

  to2d(value) { return cutaway.to2d(value, this.start, this.end); }

  from2d(value) { return cutaway.from2d(value, this.start, this.end); }


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
        for ( const cutaway of this.combinedCutaways ) {
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
   * Use Clipper to join regions together.
   * This simplifies the walking algorithm.
   * For floating regions or tiles, still might fall from one to another, so must account for that.
   * @param {PIXI.Point} start2d
   * @param {PIXI.Point} end2d          Must be different from start2d.
   */
  _constructWalkingPath(start2d, end2d) {
    start2d.roundDecimals(2);  // The 2d path uses squared values, so 2 decimals is appropriate if the 3d point is rounded to 1 decimal.
    end2d.roundDecimals(2);

    // Temporary points.
    using currPosition = start2d.clone();
    using currDirection = this.constructor.DOWN.clone();
    using prevDirection = this.constructor.DOWN.clone();

    const checkpoints = [];
    let currSurface = undefined;
    const cutawaysSet = new Set(this.combinedCutaways);

    // Helpers
    const freeFall = () => {
      cutawaysSet.add(currSurface.cutaway);
      currSurface = undefined;
    };
    const addCheckpoint = () => {
      if ( !checkpoints.length ||
        !checkpoints.at(-1).almostEqual(currPosition) ) checkpoints.push(currPosition.clone());
    };

    // Numerical errors with intersection tests will creep in unless we round the position.
    const updatePosition = newPosition => {
      currPosition.copyFrom(newPosition);
      currPosition.roundDecimals(2);
    };

    let currT = 0;
    let iter = 0;
    const maxIter = 1000;
    const maxT = end2d.x - start2d.x;
    while ( currT < 1 && iter++ < maxIter ) {
      addCheckpoint();

      // Locate a surface.
      if ( !currSurface ) {
        currSurface = this._supportingFloorEdge(currPosition);

        // Move down to the surface.
        cutawaysSet.delete(currSurface.cutaway);
        updatePosition(currSurface.ix);
        addCheckpoint();
        // currSurface.edge.b.subtract(currSurface.edge.a, currDirection); // Handled in for loop.
        // currDirection.normalize(); // Can skip normalization here.
      }

      // Move along the surface until:
      // 1. We hit something.
      // 2. We are moving straight down
      // 3. We are moving to the left (back toward start.)
      // 4. We pass the currT.
      const surfaceIter = currSurface.cutaway.iterateFromEdge(currSurface.edge);
      for ( const edge of surfaceIter ) {
        prevDirection.copyFrom(currDirection);
        edge.b.subtract(edge.a, currDirection);

        // Is this edge moving vertically?
        if ( currDirection.x.almostEqual(0) ) {
          // Move vertically up.
          if ( currDirection.y > 0 ) {
            currPosition.y = edge.b.y; // Edges should already be sufficiently rounded, but just in case.
            updatePosition(currPosition);
          }

          // Or move vertically down (free fall).
          else {
            freeFall();
            break;
          }

        // Is this edge moving backward (underhang or overhang)?
        } else if ( currDirection.x < 0 ) {
          // If we were moving up, keep moving up.
          if (  prevDirection.x.almostEqual(0) && prevDirection.y > 0 ) {
            currDirection.copyFrom(prevDirection);
            currPosition.y = 1e06; // Free fall from top, but only back to this surface.
            currSurface = this._supportingFloorEdge(currPosition, [currSurface.cutaway]);
            updatePosition(currSurface.ix);

          // Otherwise, fall.
          } else {
            freeFall();
            break;
          }
        }

        // This edge is moving forward.
        else {
          // Look for the closest obstacle.
          const closestObstacle = this._closestObstacleAlongSegment(currPosition, edge.b, cutawaysSet);
          if ( closestObstacle && closestObstacle.ix.t0 > 0 ) {
            cutawaysSet.add(currSurface.cutaway)
            cutawaysSet.delete(closestObstacle.cutaway);
            currSurface = closestObstacle;
            currSurface.edge.b.subtract(currSurface.edge.a, currDirection);
            updatePosition(closestObstacle.ix);
            break; // Moving to new surface.
          } else updatePosition(edge.b); // Move to end of edge.
        }

        addCheckpoint();

        // Are we done?
        currT = (currPosition.x - start2d.x ) / maxT
        if ( currT > 1 || iter++ > maxIter ) break;
      }

      // Are we done?
      currT = (currPosition.x - start2d.x ) / maxT
    }
    if ( iter >= maxIter ) console.error(`Too many iterations for ${start2d} --> ${end2d} (${this.start} --> ${this.end})`);

    this.#adjustEndpoint(checkpoints, end2d);
    if ( checkpoints.length === 1 ) return [checkpoints[0], checkpoints[0]]; // Avoid error where Token##preUpdateMovement assumes movement constrained and goes no further.
    return checkpoints;
  }

  #adjustEndpoint(waypoints, end2d) {
    // Confirm where the endpoint is located in the final edge.
    if ( waypoints.length < 2 ) return waypoints;
    const a = waypoints.at(-2);
    const b = waypoints.at(-1);
    if ( a.almostEqual(b) ) throw Error("_constructWalkingPath returned duplicate end waypoints.");

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

  constructBurrowingPath(a, b, initialize = true) {
    if ( initialize ) this._initialize(a, b);
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
  constructFlyingPath(a, b, initialize = true) {
    if ( initialize ) this._initialize(a, b);
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
    if ( this.combinedCutaways.some(cutHandler => cutHandler.testPoint(mid)) ) return false;
    const ixFound = this.combinedCutaways.some(cutHandler => {
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
    for ( const cutHandler of this.combinedCutaways ) {
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
   * @returns {object}
   * - @prop {CutawayHandler} cutaway
   * - @prop {Edge2d} edge
   * - @prop {PIXI.Point} ix
   */
  _supportingFloorEdge(pt2d, cutaways, _iter = 0) {
    if ( _iter > 2 ) throw Error(`_supportingFloorEdge failed to locate edge for ${this.start} -> ${this.end}`);
    cutaways ??= this.combinedCutaways
    const SURFACE_EPSILON = 0.5;
    using a = PIXI.Point.tmp.set(pt2d.x, pt2d.y + SURFACE_EPSILON);
    using b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1e06);

    let minT = Number.POSITIVE_INFINITY;
    let res;
    for ( const cutaway of cutaways ) {
      for ( const edgeIx of cutaway.iterateValidEdgeIntersections(a, b) ) {
        if ( edgeIx.ix.t0 >= minT ) continue;
        minT = edgeIx.ix.t0;
        res = edgeIx;
      }
    }
    if ( !res ) {
      const newPt = PIXI.Point.tmp.set(pt2d.x, this._nearestSupport(pt2d).elevation);
      return this._supportingFloorEdge(newPt, cutaways, _iter);
    }
    return res;
  }

  /**
   * Find the next obstacle along a segment.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {object|null} The matching obstacle or null.
   */
  _closestObstacleAlongSegment(a2d, b2d, obstacles) {
    obstacles ??= this.combinedCutaways
    let minT = 1;
    let closestObstacle = null;
    for ( const cutaway of obstacles ) {
      for ( const edgeIx of cutaway.iterateValidEdgeIntersections(a2d, b2d) ) {
        if ( edgeIx.ix.t0 > minT ) continue;
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
          if ( !almostLessThan(pt2d.y, b.y) ) break; // Have not gotten to the point yet.
          if ( pt2d.y.almostEqual(b.y) ) out.location ||= LOCS.GROUND;
          else out.location = LOCS.BELOW;
          break;
        }
        case VERTICAL.RIGHT: { // Treat as outside the cutaway. No change to floor.
          out.edge = VERTICAL.RIGHT;
          if ( !almostLessThan(pt2d.y, b.y) ) break; // Have not gotten to the point yet.
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
   * Does this edge contain a2d?
   * @param {Edge2d} edge
   * @param {CutawayPoint} a2d
   * @returns {boolean|null} Null if moving backwards at the intersection point with a2d.
   */
  #isStartingEdge(edge, a2d) {
    if ( edge.a.almostEqual(a2d) ) return true;
    if ( edge.b.almostEqual(a2d) ) return false;

    // Test for vertical A|B.
    if ( edge.a.x === edge.b.x ) return edge.a.x.almostEqual(a2d.x) && almostBetween(a2d.y, edge.a.y, edge.b.y);

    // Test for ix with non-vertical A|B.
    const a1 = PIXI.Point.tmp.set(a2d.x, a2d.y + 1);
    const a2 = PIXI.Point.tmp.set(a2d.x, a2d.y - 1);
    if ( foundry.utils.lineSegmentIntersects(edge.a, edge.b, a1, a2) ) {
      a1.release();
      a2.release();
      if ( edge.a.x > edge.b.x ) return null; // Moving backwards.
      return true;
    }
    a1.release();
    a2.release();
    return false;
  }

  /**
   * Does this edge pass b2d x value?
   * @param {Edge2d} edge
   * @param {CutawayPoint} b2d
   * @returns {PIXI.Point[]|null} Points to add if necessary; null if not at the ending edge.
   */
  #isEndingEdge(edge, b2d) {
    if ( edge.a.x > edge.b.x ) return []; // Moving backwards, so nothing to add but need to cancel the move.
    if ( edge.b.x < b2d.x ) return null;

    // Test for vertical A|B.
    if ( edge.a.x === edge.b.x && edge.a.x.almostEqual(b2d.x) ) {
      // Moving up or down.
      if ( b2d.y.almostEqual(edge.a.y) ) return [edge.a];
      if ( almostBetween(b2d.y, edge.a.y, edge.b.y) ) return [edge.a, b2d];
      return [edge.a, edge.b];
    }

    // Test for ix in non-vertical A|B.
    if ( almostBetween(b2d.x, edge.a.x, edge.b.x) ) {
      if ( edge.a.x.almostEqual(b2d.x) ) return [edge.a];

      const a1 = PIXI.Point.tmp.set(b2d.x, b2d.y + 1);
      const a2 = PIXI.Point.tmp.set(b2d.x, b2d.y - 1);
      const ix = foundry.utils.lineLineIntersection(edge.a, edge.b, a1, a2);
      a1.release();
      a2.release();
      return [edge.a, _ixToPoint(ix)];
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

  /**
   * Iterate over the valid edges that intersect a segment.
   * Only edges to the left or top are valid.
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @yields {object}
   * - @prop {CutawayHandler} cutaway (this cutaway)
   * - @prop {Edge2d} edge
   * - @prop {PIXI.Point} ix
   */
  *iterateValidEdgeIntersections(a, b) {
    for ( const edge of this.cutPoly.iterateEdges() ) {
      // If vertical edge, only bottom --> top count (left edge).
      if ( edge.a.x.almostEqual(edge.b.x) ) {
        if ( edge.a.y > edge.b.y ) continue; // Vertical, top --> bottom.
      } else if ( edge.a.x > edge.b.x ) continue; // Moves right --> left (bottom edge).

      // Test if the line intersects the edge segment (first half of lineSegmentIntersects test)
      const xa = foundry.utils.orient2dFast(a, b, edge.a);
      const xb = foundry.utils.orient2dFast(a, b, edge.b);
      if ( (xa * xb) > 0 ) continue;

      // Determine the actual intersection.
      const ix = foundry.utils.lineLineIntersection(a, b, edge.a, edge.b);
      if ( !ix ) continue;

      // Don't count intersections at the very end of the edge.
      // Use a fairly loose epsilon to deal with rounding.
      if ( edge.b.almostEqual(ix, 1e-02) ) continue;

      yield {
        cutaway: this,
        edge,
        ix: _ixToPoint(ix).roundDecimals(2),
      };
    }
  }

  /**
   * Iterate starting from a current edge. Do one full loop.
   * @param {Edge2d} targetEdge       The edge to start with
   * @yields {Edge2d}
   */
  *iterateFromEdge(targetEdge) {
    // Note that Javascript breaks the iterator when breaking a for/of loop.
    const iter = this.cutPoly.iterateEdges();
    let edge;
    while ( (edge = iter.next().value) ) {
      if ( edge.a.equals(targetEdge.a) ) {
        yield edge;
        break;
      }
    }

    // Cycle through the remaining edges.
    for ( edge of iter ) yield edge;

    for ( edge of this.cutPoly.iterateEdges() ) {
      // Yield until we get back to the target edge.
      if ( edge.a.equals(targetEdge.a) ) break;
      yield edge;
    }
  }

  /* ----- NOTE: Debugging ----- */

  /**
   * Draw a representation of the cutaway
   */
  draw(opts) {
    opts.close ??= true;
    Draw.connectPoints([...this.cutPoly.iteratePoints()].map(pt => new PIXI.Point(Math.sqrt(pt.x), -pt.y)), opts);
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


/**
 * Identify the t-value on segment A|B closest to C.
 * Picture the line segment as forming an infinite-width cylinder with a defined height
 * equal to the length of the segment.
 * 0: Point is below the cylinder.
 * 1: Point is above.
 * 0-1: If the point is within the cylinder, the function returns the percentage height
 *      of the point relative to the cylinder base.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment A|B
 * @param {Point} b     Point B on segment A|B
 * @returns {number}    T-value, where 0 is a and 1 is b. Negative numbers are before a; >1 is after b.
 * @see {@link https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line#Line_defined_by_two_points}
 */
function percentToTarget(c, a, b) {
  // Scalar projection of the vector start --> c onto the vector a|b, normalized.
  using v = b.subtract(a);
  using w = c.subtract(a);
  return v.dot(w) / v.magnitudeSquared();
}

// For an array of polygons (cutaways), find the first one that a ray hits.
// If the ray hits multiple polygons at the same point, find the one with the steepest edge.
// By steepest, we mean moving from right --> left (clockwise for cutaways), which one has the smallest y delta.
function findSurface(rayOrigin, rayDirection, cutaways, skipZero = false) {
  let minT = Number.POSITIVE_INFINITY;
  const out = {
    cutaway: undefined,
    edge: undefined,
    ix: { t0: minT },
  };

  using tmp = PIXI.Point.tmp;

  // If falling down, count as surface if we start very near it. Avoids numeric issues with ramps.
  using a = rayOrigin.clone();
  if ( rayDirection.x.almostEqual(0) && rayDirection.y < 0 ) {
    const SURFACE_EPSILON = 0.5;
    rayOrigin.add(TokenElevationHandler.UP.multiplyScalar(SURFACE_EPSILON, tmp), a);
  }
  using b = a.add(rayDirection);
  using c = a.add(rayDirection.multiplyScalar(1e06, tmp));

  for ( const cutaway of cutaways ) {
    for ( const edge of cutaway.iterateEdges() ) {
      if ( !foundry.utils.lineSegmentIntersects(a, c, edge.a, edge.b) ) continue;
      const ix = foundry.utils.lineLineIntersection(a, b, edge.a, edge.b);
      if ( !ix ) continue; // Should not happen.
      if ( ix.t0 < 0 || ix.t0 > minT ) continue;
      if ( skipZero && ix.t0.almostEqual(0) ) continue;

      // Test whether this is the steepest surface.
      if ( out.edge && ix.t0.almostEqual(minT)
        && (edge.b.y - edge.a.y) > (out.edge.b.y - out.edge.a.y) ) continue;

      minT = ix.t0;
      out.ix = ix;
      out.edge = edge;
      out.cutaway = cutaway;
    }
  }
  return out;
}


