/* globals
canvas,
CONFIG,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import {
  elevatedRegions,
  elevatedTiles,
  log } from "./util.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { RegionElevationHandler } from "./regions/RegionElevationHandler.js";
import { StraightLinePath } from "./StraightLinePath.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { instanceOrTypeOf, gridUnitsToPixels, cutaway, almostGreaterThan } from "./geometry/util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";
import { Draw } from "./geometry/Draw.js";
import { MatrixFlat } from "./geometry/MatrixFlat.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { AABB2d } from "./geometry/AABB.js";

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Also handles elevated tile "floors".
 */
export class TokenElevationHandler {

  /** @type {enum: number} */
  // TODO: Just pick 4 labels.
  static ELEVATION_LOCATIONS = {
    BELOW: -1,
    BURROWING: -1, // Synonym
    UNDERGROUND: -1,
    OUTSIDE: 0, // Allows for falsity testing.
    GROUND: 1, // Allows for falsity testing.
    ABOVE: 2,
    ABOVEGROUND: 2,
    FLYING: 2,
    FLOATING: 2,
  };

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
    whileLoop: while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;

      switch ( type ) {
        case BELOW:
        case ABOVE:
          currWaypoint = PIXI.Point.tmp.set(currWaypoint.x, cutawayHandler.elevationUponEntry(currWaypoint)); // Move up or down.
          // waypoints.push(currWaypoint);
          break;
        case GROUND: {
          const walkResult = this._walkTerrainSurfaceCutaway(currWaypoint, end2d, currRegion, waypoints);
          if ( walkResult ) {
            const walkIx = this._walkCutawayIntersection(walkResult);
            // if ( walkIx.region ) {  // Shouldn't this always be defined?
              currRegion = walkIx.region;
              cutawayHandler = this.regionCutaways.get(currRegion);
              currWaypoint = walkIx.ix;
              // waypoints.push(currWaypoint);
            // }
          } else {
            currWaypoint = waypoints.at(-1).cutpoint;
            if ( finished() ) break whileLoop; // Finished needs the currWaypoint.
            waypoints.pop();
            const support = this._nearestCutawaySupport(currWaypoint, currRegion);
            currRegion = support.controllingRegion;
            cutawayHandler = this.regionCutaways.get(currRegion);
          }
          break;
        }
      }

      type = cutawayHandler.elevationType(currWaypoint);
      waypoints.push({ type, cutpoint: currWaypoint, region: currRegion });
    }
    return waypoints;
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
 * Manages tests of cutaway polygons representing a region.
 */
class CutawayRegion {
  /** @type {AABB2d} */
  regionAABB = new AABB2d();

  /** @type {AABB2d[]} */
  aabbs = [];

  /** @type {CutawayPolygon} */
  cutPolys = [];

  /** @type {RegionElevationHandler} */
  handler;

  /** @type {Region} */
  get region() { return this.handler.region; }

  constructor(start, end, region) {
    this.handler = region[MODULE_ID];
    const cutPolys = this.cutPolys = this.handler._cutaway(start, end); // TODO: Ensure correct orientation.
    const n = cutPolys.length;
    this.aabbs.length = n;
    for ( let i = 0; i < n; i += 1 ) this.aabbs[i] = AABB2d.fromPolygon(cutPolys[i]);
    AABB2d.union(this.aabbs, this.regionAABB);
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
    for ( const aabb of this.aabbs ) {
      if ( aabb.overlapsSegment(a2d, b2d, axes) ) return true;
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
    for ( const aabb of this.aabbs ) {
      if ( aabb.containsPoint(a2d, axes) ) return true;
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
    for ( const cutPoly of this.cutPolys ) {
      if ( cutPoly.contains(pt2d.x, pt2d.y) ) return true;
    }
    return false;
  }

  // ----- NOTE: Elevation and surface testing ----- //

  /**
   * Test if point is exactly at the left edge or the right edge of a cutaway polygon.
   * @param {PIXI.Point} pt2d         Point to test
   * @param {PIXI.Polygon} cutPoly    Polygon to test
   * @returns {ELEVATION_LOCATIONS} OUTSIDE if no intersection; actual location otherwise
   */
  #verticalTangentLocation(pt2d, cutPoly) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    // (We know there is only one vertical edge for a given x here and thus always 0 or 2 points returned.)
    const verticalIxs = polygonVerticalTangentPoints(pt2d.x, cutPoly);
    if ( !verticalIxs.length ) return LOCS.OUTSIDE;

    // Either left side, moving up. or right side, moving down.
    const ground =  verticalIxs[1].y;
    return pt2d.y.almostEqual(ground) ? LOCS.GROUND : pt2d.y > ground ? LOCS.TOP : LOCS.BELOW;
  }

  /**
   * Where is this point relative to the terrain polygon cutaway?
   * @param {PIXI.Point} pt2d         Point to test
   * @param {number} index            Which polygon cutaway to test, indexed to this.aabbs
   * @returns {ELEVATION_LOCATIONS}
   */
  #elevationTypeForCutPoly(pt2d, index = 0) {
    const LOCS = TokenElevationHandler.ELEVATION_LOCATIONS;
    const aabb = this.aabbs[index];
    if ( !aabb.containsPoint(pt2d, ["x"]) ) return LOCS.OUTSIDE;

    // If this point is within the polygon, we must be burrowing.
    // PIXI.Polygon#contains returns false if the point is on the edge.
    const cutPoly = this.cutPolys[index];
    if ( cutPoly.contains(pt2d.x, pt2d.y) ) return LOCS.BELOW;

    // Check if point is exactly at the left edge or the right edge.
    const verticalTangentLoc = this.#verticalTangentLocation(pt2d, cutPoly);
    if ( verticalTangentLoc !== LOCS.OUTSIDE ) return verticalTangentLoc;

    // Point could be on a surface edge or above.
    const b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1);
    const ixs = cutPoly.lineIntersections(pt2d, b);
    let maxElev = Number.NEGATIVE_INFINITY;
    for ( const ix of ixs ) maxElev = Math.max(maxElev, ix.y);
    if ( pt2d.y.almostEqual(maxElev) ) return LOCS.GROUND;
    if ( pt2d.y > maxElev ) return LOCS.ABOVE;
    return LOCS.OUTSIDE;
  }

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
    for ( let i = 0, iMax = this.cutPolys.length; i < iMax; i += 1 ) {
      switch ( this.#elevationTypeForCutPoly(pt2d, i) ) {
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
    if ( !this.handler.isRamp ) return this.handler.isElevated ? this.handler.plateauElevation : this.region.elevationE.top;

    const b = PIXI.Point.tmp.set(pt2d.x, pt2d.y - 1);
    let maxElev = Number.NEGATIVE_INFINITY;
    for ( let i = 0, iMax = this.aabbs.length; i < iMax; i += 1 ) {
      const aabb = this.aabbs[i];
      if ( !aabb.containsPoint(pt2d, xAxis) ) continue;
      const cutPoly = this.cutPolys[i];

      // Point could be exactly at the left edge or the right edge.
      // (We know there is only one vertical edge for a given x here and thus always 0 or 2 points returned.)
      const verticalIxs = polygonVerticalTangentPoints(pt2d.x, cutPoly);
      if ( verticalIxs.length ) return verticalIxs[1].y // Either left side, moving up. or right side, moving down.

      // Intersect the cut polygon with a vertical line to determine the maximum location at that point.
      const ixs = cutPoly.lineIntersections(pt2d, b);
      for ( const ix of ixs ) maxElev = Math.max(maxElev, ix.y);
    }
    return maxElev;
  }

  /**
   * For a given cutaway line, get the 2d points representing travel along the surface of this region.
   * @param {PIXI.Point} a2d      A point on the line
   * @param {PIXI.Point} b2d      A second point on the line later than first in the x direction
   * @returns {PIXI.Point[]}      Points on the top of the cutaway polygon for the region.
   */
  surfaceWaypoints(a2d, b2d) {
    const lli = foundry.utils.lineLineIntersection;
    const c2d = PIXI.Point.tmp.set(a2d.x, a2d.y - 1);
    const d2d = PIXI.Point.tmp.set(b2d.x, b2d.y - 1);
    return this.cutPolys.map(cutPoly => {
      // v0 ... a ... b ... v1 --> a, b
      // a ... v0 ... b ... v1 --> v0, b
      // v0 ... v1 ... a ... b --> []
      // v0 ... a ... v1 ... b --> a, v1

      /*
      a ~ v0 ? drop a, add v0; aFound = true
      v0 < a ? drop v0
      v0 > a ? add v0; aFound = true

      a ~ v ? drop a, add v; aFound = true
      v < a ? drop v
      v > a ? add a at vertical ix with v0|v1; aFound = true; add v

      Once a is found
      v < b ? add v
      v ~ b ? add v; break
      v > b ? add b at vertical ix with v0|v1; break

      if we reach the end:
      v < v0. Pop the last addition, which should have been v0; break
      */

      const out = [];
      const iter = cutPoly.iteratePoints({ close: false });
      let v0 = iter.next().value;
      let foundA = almostGreaterThan(v0.x, a2d.x); // v ≥ a.
      if ( foundA ) out.push(v0);
      for ( const v of iter ) {
        if ( !foundA ) {
          foundA = almostGreaterThan(v.x, a2d.x);
          if ( foundA ) { // v ≥ a.
            if ( !v.x.almostEqual(a2d.x) ) {
              const ix = lli(v0, v, a2d, c2d);
              out.push(_ixToPoint(ix));
            }
          }
          v0 = v;
        }

        if ( !foundA ) {
          v0 = v;
          continue;
        }

        // A is found.
        if ( almostGreaterThan(v.x, b2d.x) ) {
          // Reached b.
          if ( v.x.almostEqual(b2d.x) ) out.push(v);
          else {
            const ix = lli(v0, v, b2d, d2d);
            out.push(_ixToPoint(ix));
          }
          break;
        }

        // Are we moving backwards?
        if ( v.x < v0.x ) {
         out.pop();
         break;
        }

        // Cycle to next.
        out.push(v);
        v0 = v;
      }
      return out;
    });
  }

  /**
   * Does a 2d segment definitely intersect this region?
   * Does not test bounds.
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {boolean}
   */
  lineSegmentIntersects(a2d, b2d) {
    for ( const cutPoly of this.cutPolys ) {
      if ( cutPoly.lineSegmentIntersects(a2d, b2d) ) return true;
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
    for ( const cutPoly of this.cutPolys ) {
      if ( cutPoly.lineSegmentCrosses(a2d, b2d, opts) ) return true;
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
    for ( const cutPoly of this.cutPolys ) {
      const ixsPoly = cutPoly.segmentIntersections(a2d, b2d);
      /*if ( inside ) {
        if ( !ixsPoly[0].almostEqual(a2d) && cutPoly.contains(a2d.x, a2d.y) ) ixsPoly.unshift(a2d);
        if ( !ixsPoly.at(-1).almostEqual(b2d) && cutPoly.contains(b2d.x, b2d.y) ) ixsPoly.unshift(b2d);
      }*/
      ixs.push(...ixsPoly);
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
    if ( poly.contains(pt.x, pt.y) ) return locs.UNDERGROUND;
  }
  return locs.FLOATING;
}


/**
 * Invert one or more polygons by taking the bounds of the group and XOR using Clipper
 * @param {PIXI.Polygon[]} polys
 * @returns {PIXI.Polygon[]} The inverted polygon(s)
 */
function invertPolygons(polys) {
  let combinedBounds = polys[0].getBounds();
  for ( let i = 1, n = polys.length; i < n; i += 1 ) combinedBounds = combinedBounds.union(polys[i].getBounds());

  // Pad the bounds to limit unconnected polygons.
  combinedBounds.pad(0, 2);

  const polyPaths = ClipperPaths.fromPolygons(polys);
  const boundsPath = ClipperPaths.fromPolygons([combinedBounds.toPolygon()]);
  const invertedPath = polyPaths.diffPaths(boundsPath);
  return invertedPath.toPolygons();
}

