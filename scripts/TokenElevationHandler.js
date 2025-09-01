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
  elevatedTiles,
  log } from "./util.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { instanceOrTypeOf, cutaway, almostGreaterThan, almostBetween } from "./geometry/util.js";
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

  get flying() { return this.constructor.tokenIsFlying(this.token); }

  get burrowing() { return this.constructor.tokenIsBurrowing(this.token); }

  get walking() { return this.constructor.tokenIsWalking(this.token); }

  initialize(start, end) {
    this.regions = this.constructor.filterElevatedRegionsByXYSegment(start, end);
    this.tiles = this.constructor.filterElevatedTilesByXYSegment(start, end);

    this.regionCutaways = new WeakMap();
    this.regions.forEach(r => this.regionCutaways.set(r, new CutawayRegion(start, end, r)));
    this.regionCutaways.set(canvas.scene, new CutawayRegion(start, end, canvas.scene));

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
          const cutPoly = CutawayPolygon.fromCutawayPoints(poly.points, start, end);
          return new CutawayHandler(cutPoly);
        });

      // Revert back the original polygons.
      polys.forEach(poly => poly.reverseOrientation())
    }
  }


  // ----- NOTE: Primary methods ----- //

  constructPath(start, end, { flying, burrowing, walking } = {}) {
    start = ElevatedPoint.fromObject(start);
    end = ElevatedPoint.fromObject(end);

    // if ( start.equals(end) ) return [start, end];
    flying ??= this.flying;
    burrowing ??= this.burrowing;
    walking ??= this.walking;

    // Simple case: Token unbound by terrain; can fly and burrow!
    if ( flying && burrowing || !(flying || burrowing || walking) ) {
      return [start, end];

      /*
      this.initialize(start, end);
      if ( this.canEndBelow ) return [start, end];
      const endType = this.elevationType(end, this.token, this.regions, this.tiles);
      if ( endType !== this.constructor.ELEVATION_LOCATIONS.BELOW ) return [start, end];
      const support = this.nearestSupport(end, true);
      return [start, ElevatedPoint.fromLocationWithElevation(end, support.elevation)];
      */
    }

    if ( burrowing ) return this.constructBurrowingPath(start, end);
    if ( flying ) return this.constructFlyingPath(start, end);
    return this.constructWalkingPath(start, end);
  }

  constructWalkingPath(start, end) {
    const res = this._constructWalkingPath(start, end);
    return res.map(obj => cutaway.from2d(obj.cutpoint, start, end));
  }

  constructBurrowingPath(start, end) {
    const res = this._constructWalkingPath(start, end);
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;

    /* Can we get there faster by burrowing?
    Track elevation changes:
    Anchors:
    - When on ground (skip surface walk)
    - When burrowing

    Test anchors:
    - When moving down, test if we can get there faster using the anchor position.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor in case the regions connect/overlap.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
    const anchors = [];
    let movedToFloor = false;
    const MAX_ITER = 10000;
    let nIters = 0;
    for ( let i = 0, iMax = res.length; i < iMax; i += 1 ) {
      nIters += 1;
      if ( nIters > MAX_ITER ) break;
      const obj = res[i];
      const currWaypoint = obj.cutpoint;
      if ( movedToFloor ) {
        movedToFloor = false;
        if ( obj.type === BELOW || obj.type === GROUND ) {
          // Test anchors.
          // If can get from anchor to waypoint while always within at least one region, can burrow there.
          anchorLoop: for ( const [idx, anchor] of anchors.entries() ) {
            const a = res[anchor].cutpoint;

            const cutawayIxs = [...this.regions, canvas.scene]
              // Must remain within at least one region at all times.
              .filter(r => {
                const cutawayHandler = this.regionCutaways.get(r);
                const loc = cutawayHandler.elevationType(a);
                return loc === GROUND || loc === BELOW;
              })

              // Test each intersection to see if we are still within a region.
              // _cutawayIntersections will return the currWaypoint if it is within the region. Must test all between.
              .flatMap(r => {
                const cutawayHandler = this.regionCutaways.get(r);
                const ixs = cutawayHandler.segmentIntersections(a, currWaypoint);
                ixs.sort((a, b) => a.t0 - b.t0);
                let movingInto = true;
                return ixs.map(ix => {
                  const out = { ix, movingInto };
                  movingInto = !movingInto;
                  return out;
                });
              });
            if ( !cutawayIxs.length ) continue;
            cutawayIxs.sort((a, b) => a.ix.t0 - b.ix.t0); // For cutaways, the x value functions as t0.

            if ( !cutawayIxs.at(-1).ix.almostEqual(currWaypoint) ) continue;
            let numInside = 0;
            for ( let i = 0, iMax = cutawayIxs.length - 1; i < iMax; i += 1 ) {
              cutawayIxs[i].movingInto ? numInside++ : numInside--;
              if ( numInside < 1 ) continue anchorLoop;
            }
            const nDeletions = i - anchor - 1; // Delete intermediate waypoints
            res.splice(anchor+1, nDeletions);
            anchors.splice(idx);
            i -= nDeletions; // Reset i to the next waypoint after the deletions.
            iMax = res.length
            break;
          }
        }
      }

      if ( obj.surfaceWalk ) continue;
      switch ( obj.type ) {
        case BELOW:
        case GROUND: anchors.push(i); break;
        case ABOVE: movedToFloor = true; break;
      }
    }
    return res.map(obj => cutaway.from2d(obj.cutpoint, start, end));
  }

  constructFlyingPath(start, end) {
    // TODO: Handle floating regions.
    // - Combine all cutaway polygons in Clipper.
    // - If more than one cutaway, then some are floating (otherwise, all connected via scene cutaway)
    // - Link TR corners to TL corners. Incl. start, end.
    // - Draw line from TR to BL corner to next region intersect and add as path. (Moving under region than flying diagonal up.)
    // - Pathfinding to determine optimal path?

    const path = this._constructWalkingPath(start, end);
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;

    /* Can we get there faster by flying?
    Track elevation changes:
    Anchors:
    - Start
    - Every move down at the point prior to the down move, add anchor

    Test anchors:
    - When moving up, test if can get to the up location from an anchor faster.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
    const anchors = [];
    let movedUp = false;
    const MAX_ITER = 10000;
    let nIters = 0;
    for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
      nIters += 1;
      if ( nIters > MAX_ITER ) break;
      const obj = path[i];
      if ( movedUp ) {
        movedUp = false;
        i = this.#adjustFlightAnchors(anchors, path, i);
        iMax = path.length
      }

      if ( obj.surfaceWalk ) continue;
      switch ( obj.type ) {
        case ABOVE:
        case GROUND: anchors.push(i); break;
        case BELOW: movedUp = true; break;
      }
    }

    // Always check the end point.
    this.#adjustFlightAnchors(anchors, path, path.length - 1);
    return path.map(obj => cutaway.from2d(obj.cutpoint, start, end));
  }

  #adjustFlightAnchors(anchors, path, i) {
    const { ABOVE, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const obj = path[i];
    if ( !(obj.type === ABOVE || obj.type === GROUND) ) return i;
    const currWaypoint = obj.cutpoint;

    // Test if an anchor will get us there faster. Use the first viable anchor.
    for ( const [idx, anchor] of anchors.entries() ) {
      if ( this._flightIntersectsCutaway(path[anchor].cutpoint, currWaypoint) ) continue;
      const nDeletions = i - anchor - 1; // Delete intermediate waypoints
      path.splice(anchor+1, nDeletions);
      anchors.splice(idx);
      i -= nDeletions; // Reset i to the next waypoint after the deletions.
      // iMax = res.length
      break;
    }
    return i;
  }



   /* Walking
      Walk along terrain surfaces, falling to next support when the terrain ends.
      • Cannot move vertically unless at a terrain intersection or moving along ramp/steps surface.
      • Cannot move within a terrain.

      Algorithm:
      1. If on a region. Follow the region's surface until it ends or intersects another region.
      2. If above a region. Move vertically down.
      3. If below a region. Move vertically up.
    */
  _constructWalkingPath(start, end) {
    this.initialize(start, end);
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const start2d = cutaway.to2d(start, start, end);
    const end2d = cutaway.to2d(end, start, end);

    let currWaypoint = start2d;
    const support = this._nearestCutawaySupport(currWaypoint);
    let currRegion = support.controllingRegion;
    let cutawayHandler = this.regionCutaways.get(currRegion);
    let type = cutawayHandler.elevationType(currWaypoint);
    const waypoints = [{ type, cutpoint: currWaypoint, region: currRegion }];

    if ( start2d.equals(end2d)
      || !(this.regions.length || this.tiles.length) ) {
      waypoints.push({ type, cutpoint: end2d, region: currRegion });
      return waypoints;
    }

    const MAX_ITER = 10000;
    let nIters = 0;
    const finished = () => almostGreaterThan(currWaypoint.x, end2d.x); // waypoint ≥ end
    while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;
      let path = [];

      // Determine the next path point(s) assuming no intersecting region or tile.
      switch ( type ) {
        case BELOW:
          path.push(PIXI.Point.tmp.set(currWaypoint.x, cutawayHandler.elevationUponEntry(currWaypoint)))
          break;
        case ABOVE: {
          path.push(PIXI.Point.tmp.set(currWaypoint.x, Number.NEGATIVE_INFINITY)); // Fall indefinitely.
          break;
        }
        case GROUND: {
          path = cutawayHandler.surfaceWalk(currWaypoint, end2d);
          if ( path[0].almostEqual(currWaypoint)) path.shift();
        }
      }

      // Follow the path, checking for intersections:
      // - Move vertical up: Region intersects
      // - Move vertical down: Region and tile intersects
      // - Move left-to-right: Region intersects
      // - Move right-to-left: stop
      for ( const pathPt of path ) {
        // If right-to-left, stop.
        if ( currWaypoint.x > pathPt.x ) break;

        // If this path point goes nowhere, skip.
        if ( pathPt.almostEqual(currWaypoint) ) continue;

        // If falling down, get the next supporting region or tile.
        if ( currWaypoint.x === pathPt.x && currWaypoint.y > pathPt.y ) {
          const support = this._nearestCutawaySupport(currWaypoint);
          if ( support.controllingRegion !== currRegion ) {
            // Go from current waypoint down to the next support elevation.
            currRegion = support.controllingRegion;
            // cutawayHandler = this.regionCutaways.get(currRegion);
            currWaypoint = PIXI.Point.tmp.set(currWaypoint.x, support.elevation);
            waypoints.push({ type: GROUND, cutpoint: currWaypoint, region: currRegion });
            break;
          }
          // Go from current waypoint down to the next step, which should be ground in the current region.
          currWaypoint = pathPt;
          waypoints.push({ type: GROUND, cutpoint: currWaypoint, region: currRegion });
          continue;
        }

        // Moving up or moving right-to-left: Check for region intersections.
        let closestRegion = currRegion;
        let ix = { t0: Number.POSITIVE_INFINITY };
        for ( const region of this.regions ) {
          if ( region === currRegion ) continue;
          const cutawayHandler = this.regionCutaways.get(region);
          if ( !cutawayHandler.segmentInBounds(currWaypoint, pathPt) ) continue;
          if ( !cutawayHandler.lineSegmentIntersects(currWaypoint, pathPt) ) continue;
          const ixs = cutawayHandler
            .segmentIntersections(currWaypoint, pathPt)
            .filter(ix => !ix.almostEqual(currWaypoint)); // Drop intersections at the start point.
          if ( !ixs.length ) continue;
          ixs.sort((a, b) => a.t0 - b.t0);
          const regionIx = ixs[0];
          if ( regionIx.t0 >= ix.t0 ) continue;
          closestRegion = region;
          ix = regionIx;
        }
        if ( closestRegion === currRegion ) {
          // Travel to the next path point.
          currWaypoint = pathPt;
          waypoints.push({ type: GROUND, cutpoint: currWaypoint, region: currRegion });
        } else {
          // Travel to the intersection point with the next region.
          currRegion = closestRegion;
          // cutawayHandler = this.regionCutaways.get(currRegion);
          currWaypoint = _ixToPoint(ix);
          waypoints.push({ type: GROUND, cutpoint: currWaypoint, region: currRegion });
          break;
        }
      }
      if ( finished() ) break;


      cutawayHandler = this.regionCutaways.get(currRegion);
      type = cutawayHandler.elevationType(currWaypoint);
      // waypoints.push({ type, cutpoint: currWaypoint, region: currRegion });
    } // End while loop.

    // Check for closest endpoint along the last segment move.
    if ( waypoints.at(-1).cutpoint.almostEqual(currWaypoint) ) waypoints.pop();
    if ( !waypoints.at(-1).cutpoint.almostEqual(end2d) ) {
      if ( currWaypoint.almostEqual(end2d) ) waypoints.push({
        type: GROUND,
        cutpoint: currWaypoint,
        region: currRegion });
      else waypoints.push({
        type: GROUND, region:
        currRegion,
        cutPoint: foundry.utils.closestPointToSegment(end2d, waypoints.at(-1).cutpoint, currWaypoint) });
    }
    return waypoints;
  }


  /**
   * Use Clipper to join regions together.
   * This simplifies the walking algorithm.
   * For floating regions or tiles, still might fall from one to another, so must account for that.
   */
  _constructWalkingPathV2(start, end) {
    this.initialize(start, end);
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const start2d = cutaway.to2d(start, start, end);
    const end2d = cutaway.to2d(end, start, end);

    // If only a single polygon and no tiles, this is easy.
    // TODO: Handle tiles
    if ( this.combinedCutaways.length === 1 ) return this.combinedCutaways[0].surfaceWalk(start2d, end2d);

    // Multiple polygons or polygons + tiles means vertical moves down can hit a tile or drop to another polygon.
    // Note that other than for tiles, there are no intersecting polygons (combined by Clipper already).
    let currWaypoint = start2d;
    const waypoints = [start2d];

    const MAX_ITER = 10000;
    let nIters = 0;
    const finished = () => almostGreaterThan(currWaypoint.x, end2d.x); // waypoint ≥ end
    while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;

      // Determine current location.
      let { cutHandler, location, elevation } = this._cutPolyHandlerForLocation(currWaypoint);


      // Move up or down as needed.
      // TODO: Check for tiles. Should this also be done in _cutPolyHandlerForLocation?
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
    }
    return waypoints;
  }

  _cutPolyHandlerForLocation(pt2d, excludeHandler) {
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
    for ( const cutHandler of this.floatingHandlers ) {
      const elev = cutHandler.elevationUponEntry(pt2d);
      if ( elev > maxElev ) {
        maxElev = elev;
        nextFloor = cutHandler;
      }
    }
    return { cutHandler: nextFloor, location: LOCS.ABOVE, elevation: maxElev };
  }


  _walkTerrainSurfaceCutaway(currWaypoint2d, end2d, region, waypoints) {
    // Follow region surface until hitting another region or falling.
    const regionHandler = this.regionCutaways.get(region);
    const surfaceWaypoints = regionHandler.surfaceWaypoints(currWaypoint2d, end2d);
    const type = this.constructor.ELEVATION_LOCATIONS.GROUND;

    // Need to combine the different polygons and sort.
    const allSurfaceWaypoints = surfaceWaypoints.flatMap(elem => elem); // TODO: Avoid the flatMap? Combine with loop below?
    if ( surfaceWaypoints.length > 1 ) {
      // Sort by x.
      // Identify the region in/out?
      console.error("Multiple regions not yet implemented");
    }

    const otherRegions = this.regions.filter(r => r !== region);
    let a = allSurfaceWaypoints[0];
    for ( let i = 1, iMax = allSurfaceWaypoints.length; i < iMax; i += 1 ) {
      const b = allSurfaceWaypoints[i];
      const segmentRegions = otherRegions.filter(r => {
        const cutawayHandler = this.regionCutaways.get(r);
        if ( !cutawayHandler.segmentInBounds(a, b) ) return false;
        if ( !cutawayHandler.lineSegmentIntersects(a, b) ) return false;

        // Need to ignore intersections where only the initial point hits the region.
        if ( i === 1 && a.x === currWaypoint2d.x ) {
          const ixs = cutawayHandler.segmentIntersections(a, b);
          if ( ixs.length && ixs[0].almostEqual(a) ) return false;
        }
        return true;
      });
      if ( segmentRegions.length ) return { segmentRegions, a, b };
      waypoints.push({ type, cutpoint: b, region, surfaceWalk: true });
    }
    return null;
  }

  _walkTerrainSurface(currWaypoint, end, region, waypoints) {
    // Follow region surface until hitting another region or falling.
    const segments = region[MODULE_ID].surfaceSegments(currWaypoint, end);
    const otherRegions = this.regions.filter(r => r !== region);
    for ( const segment of segments ) {
      const { a, b } = segment;
      const segmentRegions = otherRegions.filter(r => r[MODULE_ID].segmentInBounds(a, b)
        && r[MODULE_ID].lineSegmentIntersects(a, b));
      if ( segmentRegions.length ) return { segmentRegions, segment };
      waypoints.push(b);
    }
    return null;
  }

  _flightIntersectsCutaway(a2d, b2d, excludeRegion) {
    return [...this.regions, canvas.scene].some(region => region !== excludeRegion && this.regionCutaways.get(region).lineSegmentCrosses(a2d, b2d));
  }

  _flightIntersects(a, b, excludeRegion) {
    return [...this.regions, canvas.scene].some(region => region !== excludeRegion && region[MODULE_ID].lineSegmentCrosses(a, b));
  }

  _flightIntersectionCutaway(a2d, b2d) {
    let closestRegion;
    let ix = { t0: Number.POSITIVE_INFINITY };
    [...this.regions, canvas.scene].forEach(region => {
      const cutHandler = this.regionCutaways.get(region);
      const ixs = cutHandler.segmentIntersections(a2d, b2d);
      if ( !ixs.length ) return;
      ixs.sort((a, b) => a.t0 - b.t0);
      const regionIx = ixs[0];
      if ( regionIx.t0 >= ix.t0 ) return;
      closestRegion = region;
      ix = regionIx;
    });
    return { region: closestRegion, ix };
  }

  _flightIntersection(a, b) {
    let closestRegion;
    let ix = { t0: Number.POSITIVE_INFINITY };
    [...this.regions, canvas.scene].forEach(region => {
      const ixs = region[MODULE_ID].segmentIntersections(a, b);
      if ( !ixs.length ) return;
      ixs.sort((a, b) => a.t0 - b.t0);
      const regionIx = ixs[0];
      if ( regionIx.t0 >= ix.t0 ) return;
      closestRegion = region;
      ix = regionIx;
    });
    return { region: closestRegion, ix };
  }

  _walkCutawayIntersection(walkResult) {
    // Determine the intersection point
    const { a, b, segmentRegions } = walkResult;
    let closestRegion;
    let ix = { t0: Number.POSITIVE_INFINITY };
    segmentRegions.forEach(region => {
      const cutHandler = this.regionCutaways.get(region);
      const ixs = cutHandler.segmentIntersections(a, b);
      if ( !ixs.length ) return;
      ixs.sort((a, b) => a.t0 - b.t0);
      const regionIx = ixs[0];
      if ( regionIx.t0 >= ix.t0 ) return;
      closestRegion = region;
      ix = regionIx;
    });
    return { region: closestRegion, ix };
  }

  _walkIntersection(walkResult) {
    // Determine the intersection point
    const segment = walkResult.segment;
    let closestRegion;
    let ix = { t0: Number.POSITIVE_INFINITY };
    walkResult.segmentRegions.forEach(region => {
      const ixs = region[MODULE_ID].segmentIntersections(segment.a , segment.b);
      if ( !ixs.length ) return;
      ixs.sort((a, b) => a.t0 - b.t0);
      const regionIx = ixs[0];
      if ( regionIx.t0 >= ix.t0 ) return;
      closestRegion = region;
      ix = regionIx;
    });
    return { region: closestRegion, ix };
  }



  /**
   * Determine if a given location is on the terrain floor, on a plateau/ramp, in the air, or
   * inside an elevated terrain or tile.
   * To be on the ground, it has to be on the region's plateau and not within another region unless it
   * is also on that other region's plateau.
   * Or at a tile elevation.
   * @param {ElevatedPoint} waypoint     Location to test
   * @param {Token} [token]                       Token doing the movement; used to test tile holes
   * @param {Region[]} [regions]                  Regions to consider; otherwise entire canvas
   * @param {Tile[]} [tiles]                      Tiles to consider; otherwise entire canvas
   * @returns {ELEVATION_LOCATIONS}
   */
  elevationType(waypoint) {
    const LOCS = this.constructor.ELEVATION_LOCATIONS;

    // TODO: Tiles
    // Not inside a region (2d): floating if above scene ground; burrowing if below.
    // Multiple overlapping regions: Consider the biggest region to control
    // - If all outside: use scene floor
    // - If underground for one, must be underground (overlapping regions don't change this)
    // - If no underground, then ground or flight control, in that order
    let grounded = false;
    let flying = false;
    for ( const region of [...this.regions, canvas.scene] ) {
      switch ( region[MODULE_ID].pointLocation(waypoint) ) {
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

  _cutawayElevationType(pt2d) {
    const LOCS = this.constructor.ELEVATION_LOCATIONS;
    let grounded = false;
    let flying = false;
    for ( const region of [...this.regions, canvas.scene] ) {
      const cutawayHandler = this.regionCutaways.get(region);
      switch ( cutawayHandler.elevationType(pt2d) ) {
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
   * Determine the nearest supporting object and its elevation from this point.
   * Could be a terrain region, tile, or scene floor.
   * If not burrowing, move up from burrowed terrain to floor of terrain.
   * @param {ElevatedPoint} waypoint              Location to test
   * @param {object} [opts]                       Options that affect the movement
   * @returns { priorType, regions, controllingRegion, elevation };
   */
  _nearestCutawaySupport(waypoint2d, excludeRegion) {
    // Burrowing, then ground, then flying.
    // Highest elevation should win.
    // But need to ensure that regions above the waypoint are ignored.
    const out = {
      elevation: canvas.scene[MODULE_ID].sceneFloor,
      controllingRegion: canvas.scene,
    };
    for ( const region of this.regions ) {
      if ( region === excludeRegion ) continue;
      const cutawayHandler = this.regionCutaways.get(region);
      const elev = cutawayHandler.elevationUponEntry(waypoint2d);
      if ( out.elevation < elev ) {
        out.elevation = elev;
        out.controllingRegion = region;
      };
    }
    return out;
  }


  /**
   * From the provided position, determine the highest supporting "floor".
   * This could be a plateau, ramp, or the scene floor.
   * @param {ElevatedPoint} waypoint     The location to test
   * @param {object} [opts]                       Options that affect the movement
   * @param {Region[]} [opts.regions]             Regions to test; if undefined all on canvas will be tested
   * @param {Tile[]} [opts.tiles]                 Tiles to test; if undefined all on canvas will be tested
   * @param {Point[]} [opts.samples]              Passed to Region#segmentizeMovement
   * @param {boolean} [opts.burrowing]            If true, will fall but not move up if already in region
   * @returns {number} The elevation for the nearest ground, in grid units
   */
  static nearestGroundElevation(waypoint, { regions, tiles, samples, burrowing = false, token } = {}) {
    if ( !instanceOrTypeOf(waypoint, ElevatedPoint) ) waypoint = ElevatedPoint.fromObject(waypoint);

    const teleport = false;
    samples ??= [{x: 0, y: 0}];
    regions = elevatedRegions(regions);
    tiles = elevatedTiles(tiles);
    const terrainFloor = canvas.scene[MODULE_ID].sceneFloor;
    let currElevation = waypoint.elevation;

    // Option 1: Waypoint is currently on a tile.
    if ( tiles.some(tile => tile[MODULE_ID].waypointOnTile(waypoint, token)) ) return waypoint.elevation;

    // Option 2: Waypoint is currently in a region.
    const currRegions = regions.filter(region => region.document.testPoint(waypoint));

    if ( burrowing && currRegions.length ) return currElevation;

    // Option 3: Fall to ground and locate intersecting regions and tiles. If below ground, move up to ground.
    if ( !currRegions.length ) {
      if ( waypoint.elevation === terrainFloor ) return terrainFloor;
      const ixs = [];
      const start = waypoint;
      const end = ElevatedPoint.fromLocationWithElevation(waypoint, terrainFloor);
      const waypoints = [start, end];
      for ( const region of regions ) {
        // Given the previous test, it would have to be an entry at this point.
        const segments = region.segmentizeMovement(waypoints, samples, { teleport });
        if ( !segments.length ) continue;
        const segment = segments[0];
        if ( segment.type !== CONFIG.Region.objectClass.MOVEMENT_SEGMENT_TYPES.ENTER ) continue;
        const dist = currElevation - segment.to.elevation;
        const elevation = () => region[MODULE_ID].elevationUponEntry(waypoint); // Don't calculate until we have to.
        ixs.push({ dist, elevation });
      }

      for ( const tile of tiles ) {
        const tm = tile[MODULE_ID];
        if ( !tm.lineSegmentIntersects(start, end) ) continue;
        const elevation = () => tile.document.elevation;
        const dist = currElevation - tile.document.elevation;
        ixs.push({ dist, elevation });
      }

      // If no regions or tiles intersected, the terrain floor is the default.
      if ( !ixs.length ) return terrainFloor;

      // Move to the first intersection and then to the top of the plateau.
      ixs.sort((a, b) => a.dist - b.dist);
      const firstIx = ixs[0];
      currElevation = firstIx.elevation();
    }
    if ( burrowing ) return currElevation;

    // Get the entry elevation for each region in turn. Take the highest.
    // If the entry elevation changes the current elevation, repeat.
    const MAX_ITER = 1e04;
    let iter = 0;
    const testPt = ElevatedPoint.fromLocationWithElevation(waypoint, currElevation);
    let maxElevation = testPt.elevation;
    do {
      iter += 1;
      testPt.elevation = maxElevation;
      // currRegionElevation = maxElevation;
      maxElevation = Number.NEGATIVE_INFINITY;
      for ( const region of regions ) {
        if ( !region.testPoint(testPt) ) continue;
        const newE = region[MODULE_ID].elevationUponEntry(waypoint);
        maxElevation = Math.max(maxElevation, newE);
      }
    } while ( maxElevation !== testPt.elevation && iter < MAX_ITER );
    if ( iter >= MAX_ITER ) console.error("nearestGroundElevation|Max iterations reached!", waypoint);

    const out = isFinite(testPt.elevation) ? testPt.elevation : currElevation;
    testPt.release();
    return out;
  }


  // ----- NOTE: Secondary methods ----- //



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
class CutawayHandler {
  /** @type {CutawayPolygon} */
  cutPoly;

  /** @type {AABB2d} */
  aabb;

  constructor(cutPoly) {
    // this.#organizePolyPoints(cutPoly);
    this.cutPoly = cutPoly;
    this.aabb = AABB2d.fromPolygon(cutPoly);
  }

  /**
   * Organize the poly points such that they go from BL --> surface --> BR.
   * BL signified by the point furthest to the left and lowest.
   * Recall that in cutaways, lowest is negative Y.
   *
   */
//   #organizePolyPoints(cutPoly) {
//     if ( cutPoly.isPositive ) cutPoly.reverseOrientation();
//     const bounds = cutPoly.getBounds();
//     const BL = PIXI.Point.tmp.set(bounds.left, bounds.bottom);
//     const firstPt = PIXI.Point.tmp.set(cutPoly.points[0], cutPoly.points[1]);
//     if ( firstPt.equals(BL) ) {
//       BL.release();
//       firstPt.release();
//       return; // Already in order.
//     }
//     firstPt.release();
//
//     // Locate the index of the point that is maximally SW.
//     let minPt = PIXI.Point.tmp.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
//     let minIndex = 0;
//     for ( let i = 0, iMax = cutPoly.points.length; i < iMax; i += 2 ) {
//       const pt = PIXI.Point.tmp.set(cutPoly.points[i], cutPoly.points[i + 1]);
//       if ( pt.x < minPt.x || pt.x === minPt.x && pt.y < minPt.y ) {
//         minPt.release();
//         minPt = pt;
//         minIndex = i;
//       } else pt.release();
//     }
//     cutPoly.points = [...cutPoly.points.slice(i), ...cutPoly.points.slice(0, i)];
//   }

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
   * Test if point is exactly at the left edge or the right edge of the cutaway polygon.
   * @param {PIXI.Point} pt2d         Point to test
   * @param {PIXI.Polygon} cutPoly    Polygon to test
   * @returns {ELEVATION_LOCATIONS|VERTICAL_LOCATIONS}
   *  OUTSIDE if no intersection; actual location otherwise
   */
  #verticalTangentLocation(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    const VERTICAL = TokenElevationHandler.VERTICAL_LOCATIONS;
    const verticalIxs = polygonVerticalTangentPoints(pt2d.x, this.cutPoly);
    if ( !verticalIxs.length ) return LOCS.OUTSIDE;

    // Either left side, moving up. or right side, moving down.
    // Left side is below or ground if at top of left.
    // Right side is special RIGHT_VERTICAL location
    // If multiple, within tangent wins, otherwise floating or outside.
    // TODO: If up and down simultaneously, first one wins. Better approach?

    let floating = false;
    let lr = 0;
    for ( let i = 1, iMax = verticalIxs.length; i < iMax; i += 2 ) {
      const a = verticalIxs[0];
      const b = verticalIxs[1];
      if ( !almostBetween(pt2d.y, a.y, b.y) ) {
        if ( pt2d.y > b.y ) floating = true;
        lr = a.y < b.y ? VERTICAL.LEFT : VERTICAL.RIGHT;
        continue;
      }

      // Left side: Below if within the segment; ground is at the top of a vertical left segment.
      // Right side: Floating unless at the BL corner, which is marked as right ground. (May or may not be actual ground.)
      if ( a.y < b.y ) { // Left side.
        if ( pt2d.y.almostEqual(b.y) ) return LOCS.GROUND | VERTICAL.LEFT;
        return LOCS.BELOW | VERTICAL.LEFT;
      } else { // Right side.
        if ( pt2d.y.almostEqual(b.y) ) return LOCS.GROUND | VERTICAL.RIGHT;
        return LOCS.ABOVE | VERTICAL.RIGHT;
      }
    }
    return floating ? (LOCS.ABOVE | lr) : LOCS.OUTSIDE;
  }

  /**
   * Where is this point relative to this terrain polygon cutaway?
   * @param {PIXI.Point} pt2d         Point to test
   * @returns {ELEVATION_LOCATIONS}
   */
  elevationType(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    if ( !this.aabb.containsPoint(pt2d, ["x"]) ) return LOCS.OUTSIDE;

    // If this point is within the polygon, we must be burrowing.
    // PIXI.Polygon#contains returns false if the point is on the edge.
    const cutPoly = this.cutPoly;
    if ( cutPoly.contains(pt2d.x, pt2d.y) ) return LOCS.BELOW;

    // Check if point is exactly at a left edge or right edge.
    const verticalTangentLoc = this.#verticalTangentLocation(pt2d, cutPoly);
    if ( verticalTangentLoc !== LOCS.OUTSIDE ) {
      if ( verticalTangentLoc & LOCS.BELOW ) return LOCS.BELOW;
      if ( verticalTangentLoc & LOCS.ABOVE ) return LOCS.ABOVE;
      return LOCS.GROUND;
    }

    // Point could be on a surface edge or above.
    // If not on the surface, must be floating.
    const b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1);
    const ixs = cutPoly.lineIntersections(pt2d, b);
    for ( const ix of ixs ) if ( pt2d.almostEqual(ix) ) return LOCS.GROUND;
    return LOCS.ABOVE;
  }

  /**
   * Determine the elevation upon moving into this cutaway polygon.
   * If the point is above, fall to the next surface.
   * If point is below, move up to next surface.
   * The provided location is not tested for whether it is within the region.
   * @param {PIXI.Point} a   Position immediately upon entry
   * @returns {number} The elevation of the plateau or the ramp at this location
   *   Return Number.NEGATIVE_INFINITY if it would be outside.
   */
  elevationUponEntry(pt2d) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    const VERTICAL = TokenElevationHandler.VERTICAL_LOCATIONS;

    const type = this.elevationType(pt2d);
    if ( type === LOCS.OUTSIDE ) return Number.NEGATIVE_INFINITY;
    if ( type === LOCS.GROUND || type === (LOCS.GROUND | VERTICAL.LEFT) ) return pt2d.y;

    let ixs;
    if ( type === LOCS.BELOW || type === LOCS.ABOVE ) {
      // Intersect the polygon with a vertical line.
      const b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1);
      ixs = this.cutPoly.lineIntersections(pt2d, b);
      b.release();
    } else ixs = polygonVerticalTangentPoints(pt2d.x, this.cutPoly); // Vertical left or right.

    let elev;
    if ( type & LOCS.BELOW > 0 ) {
      // Closest elevation point above the point.
      elev = Number.POSITIVE_INFINITY;
      for ( const ix of ixs ) elev = Math.min(elev, Math.max(ix.y, pt2d.y));
    } else {
      // Closest elevation point below the point.
      elev = Number.NEGATIVE_INFINITY;
      for ( const ix of ixs ) elev = Math.max(elev, Math.min(ix.y, pt2d.y));
    }
    return elev;
  }

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
  segmentIntersections(a2d, b2d) { return this.cutPoly.segmentIntersections(a2d, b2d); }

  /**
   * Obtain the intersection points for a line against this cut polygon.
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  lineIntersections(a2d, b2d) { return this.cutPoly.lineIntersections(a2d, b2d); }

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

/**
 * Determine if there is an intersection of a segment in an array of polygons.
 * @param {Point} a                 The starting endpoint of the segment
 * @param {Point} b                 The ending endpoint of the segment
 * @param {PIXI.Polygon[]} polys    The polygons to test; May have cached properties:
 *   - _xMinMax: minimum and maximum x values
 *   - _edges: Array of edges for the polygon
 * @param {PIXI.Polygon} skipPoly   Ignore this polygon
 * @returns {boolean}
 */
function segmentIntersectsPolygons(a, b, combinedPolys, skipPoly) {
  for ( const poly of combinedPolys ) {
    if ( poly === skipPoly ) continue;
    poly._minMax ??= Math.minMax(...poly.pixiPoints({ close: false }).map(pt => pt.x));
    if ( poly._xMinMax && poly._xMinMax.max <= a.x ) continue;
    if ( poly.lineSegmentIntersects(a, b) ) return true;
  }
  return false;
}

/**
 * Locate all intersections of a segment in an array of polygons.
 * @param {Point} a                 The starting endpoint of the segment
 * @param {Point} b                 The ending endpoint of the segment
 * @param {PIXI.Polygon[]} polys    The polygons to test; May have cached properties:
 *   - _xMinMax: minimum and maximum x values
 *   - _edges: Array of edges for the polygon
 * @param {PIXI.Polygon} skipPoly   Ignore this polygon
 * Note: If not already present, these properties will be cached.
 * @returns {object[]} The intersections
 *   - @prop {number} x       X-coordinate of the intersection
 *   - @prop {number} y       Y-coordinate of the intersection
 *   - @prop {number} t0      Percent of a|b where the intersection occurred
 *   - @prop {Segment} edge   Polygon edge where the intersection occurred
 *   - @prop {Segment} poly   Polygon where the intersection occurred
 */
function polygonsIntersections(a, b, combinedPolys, skipPoly) {
  const ixs = [];
  combinedPolys.forEach(poly => {
    if ( poly === skipPoly ) return;
    poly._minMax ??= Math.minMax(...poly.pixiPoints({ close: false }).map(pt => pt.x));
    if ( poly._xMinMax && poly._xMinMax.max <= a.x ) return;
    if ( !poly.lineSegmentIntersects(a, b) ) return [];

    // Retrieve the indices so that the edge can be linked to the intersection, for traversing the poly.
    const ixIndices = poly.segmentIntersections(a, b, { indices: true });
    ixIndices.forEach(i => {
      const edge = poly.pixiEdges()[i];
      const ix = foundry.utils.lineLineIntersection(a, b, edge.A, edge.B);
      if ( !ix.t0 ) return; // Skip intersections that are at the a point.
      ix.edge = edge;
      ix.poly = poly;
      ixs.push(_ixToPoint(ix));
    });
  });
  ixs.sort((a, b) => a.t0 - b.t0);
  return ixs;
}

function _ixToPoint(ix) {
  const pt = PIXI.Point.tmp.set(ix.x, ix.y);
  pt.t0 = ix.t0;
  return pt;
}

/**
 * Determine if this point is on an edge of the polygon.
 * @param {Point} a               The point to test
 * @param {PIXI.Polygon} poly     The polygon to test
 * @returns {Edge|false} The first edge it is on (more than one if on endpoint)
 */
function pointOnPolygonEdge(a, poly, epsilon = 1e-08) {
  a = PIXI.Point.tmp.copyFrom(a);
  for ( const edge of poly.pixiEdges() ) {
    if ( edge.A.almostEqual(edge.B) ) {
      log("pointOnPolygonEdge|A and B are nearly equal");
      PIXI.Point.release(edge.A, edge.B);
      continue;
    }
    const pt = foundry.utils.closestPointToSegment(a, edge.A, edge.B);
    if ( a.almostEqual(pt, epsilon) ) {
      a.release();
      return edge;
    }
    PIXI.Point.release(edge.A, edge.B);
  }
  a.release();
  return false;
}

/**
 * Determine the elevation type for a cutaway position with regard to cutaway polygon(s)
 * Underground: contained in polygon
 * Above ground: not contained and not on edge. pointOnPolygonEdge
 * On ground: pointOnPolygonEdge
 * Points on the right/bottom of these inverted polygons will be considered underground, not ground
 * @param {Point} pt                    The cutaway point to test
 * @param {PIXI.Polygon[]} polys        The polygons to test
 * @returns {ELEVATION_LOCATIONS}
 */
function cutawayElevationType(pt, polys) {
  const locs = TokenElevationHandler.ELEVATION_LOCATIONS;
  for ( const poly of polys ) {
    const edge = pointOnPolygonEdge(pt, poly, 0.1);
    if ( !edge ) continue;

    // If on a vertical edge, only counts as on the ground if it is at the top or bottom. Otherwise floating.
    if ( edge.A.x === edge.B.x && !(edge.A.almostEqual(pt) || edge.B.almostEqual(pt))) return locs.FLOATING;
    return locs.GROUND;
  }
  for ( const poly of polys ) {
    if ( poly.contains(pt.x, pt.y) ) return locs.BELOW;
  }
  return locs.FLOATING;
}
