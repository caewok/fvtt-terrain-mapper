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
import { instanceOrTypeOf, gridUnitsToPixels, cutaway } from "./geometry/util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";
import { Draw } from "./geometry/Draw.js";
import { MatrixFlat } from "./geometry/MatrixFlat.js";
import { Point3d } from "./geometry/3d/Point3d.js";

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Also handles elevated tile "floors".
 */
export class ElevationHandlerV2 {

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

  flying = false;

  burrowing = false;

  canEndBelow = false;

  initialize(start, end) {
    this.regions = this.constructor.filterElevatedRegionsByXYSegment(start, end);
    this.tiles = this.constructor.filterElevatedTilesByXYSegment(start, end);
  }

  initializeOptions({ flying, burrowing, canEndBelow, token } = {}) {
    if ( flying != null ) this.flying = flying;
    if ( burrowing != null ) this.burrowing = burrowing;
    if ( canEndBelow != null ) this.canEndBelow = canEndBelow;
    if ( token ) this.token = token;
  }

  // ----- NOTE: Primary methods ----- //

  constructPath(start, end, opts) {
    if ( start.equals(end) ) return [start, end];
    this.initializeOptions(opts);
    this.initialize(start, end);
    if ( !(this.regions.length || this.tiles.length) )  return [start, end];

    // Simple case: Token unbound by terrain; can fly and burrow!
    if ( this.flying && this.burrowing ) {
      if ( this.canEndBelow ) return [start, end];
      const endType = this.elevationType(end, this.token, this.regions, this.tiles);
      if ( endType !== this.constructor.ELEVATION_LOCATIONS.BELOW ) return [start, end];
      const support = this.nearestSupport(end, true);
      return [start, ElevatedPoint.fromLocationWithElevation(end, support.elevation)];
    }

    if ( this.burrowing ) return this._constructBurrowingPath(start, end);
    if ( this.flying ) return this._constructFlyingPath(start, end);
    return this._constructWalkingPath(start, end);
  }

  /**
   * Used to get incremental step when at the end of a region.
   * @type {Point3d}
   */
  #dir2d = new Point3d();

  #calculate2dStep(start, end) {
    // Normalized 2d direction, setting z to 0.
    // So that a step along the XY line equals 1 pixel if direction is X = 1 or Y = 1.
    end.subtract(start, this.#dir2d);
    this.#dir2d.z = 0;
    this.#dir2d.normalize(this.#dir2d);
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
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const waypoints = [start];
    let currWaypoint = start;
    const finished = () => currWaypoint.almostEqualXY(end);
    this.#calculate2dStep(start, end);

    // Move start to ground elevation if necessary.
    const startType = this.elevationType(start);
    if ( startType === ABOVE || startType === BELOW ) {
      const support = this.nearestSupport(start);
      currWaypoint = ElevatedPoint.fromLocationWithElevation(end, support.elevation);
      waypoints.push(currWaypoint);
    }

    const support = this.nearestSupport(currWaypoint);
    let currRegion = support.controllingRegion;

    const MAX_ITER = 1000;
    let nIters = 0;
    while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;

      switch ( this.elevationType(currWaypoint) ) {
        case BELOW: {
          currWaypoint = ElevatedPoint.fromLocationWithElevation(currWaypoint, currRegion[MODULE_ID].elevationUponEntry(currWaypoint)); // Move up.
          waypoints.push(currWaypoint);
          break;
        }
        case ABOVE: {
          currWaypoint = ElevatedPoint.fromLocationWithElevation(currWaypoint, currRegion[MODULE_ID].elevationUponEntry(currWaypoint)); // Move down.
          waypoints.push(currWaypoint);
          break;
        }
        case GROUND: {
          const walkResult = this._walkTerrainSurface(currWaypoint, end, currRegion, waypoints);
          if ( walkResult ) {
            const walkIx = this._walkIntersection(walkResult);
            if ( walkIx.region ) {  // Shouldn't this always be defined?
              currRegion = walkIx.region;
              currWaypoint = walkIx.ix;
              waypoints.push(currWaypoint);
            }
          } else {
            currWaypoint = waypoints.at(-1);
            if ( !finished() ) {
              currWaypoint.add(this.#dir2d, currWaypoint); // Step ~1 pixel along the XY line.
              const support = this.nearestSupport(currWaypoint);
              currRegion = support.controllingRegion;
            }
          }

          break;
        }
      }
    }

    // Cannot move up or down, so whenever we hit the XY position, we are done.
    return waypoints;
  }

   /* Burrowing
    Can simply move through terrain regions.
    But:
    • Cannot move up if the terrain does not extend further upward.
    • Cannot move down if the terrain stops.
    • Must drop if moving along the path drops us off a terrain or tile.

    Algorithm:
    1. If on a region
    - If destination is at or below, move to edge of region. Keep in mind ramp/step geometry.
    - If destination is above move along region until at destination x/y or at end or run into region

    2. If within a region
    - Move to edge of region.

    3. If above a region
    - Fall to nearest support

    */
  _constructBurrowingPath(start, end) {
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const waypoints = [start];
    let currWaypoint = start;
    const finished = () => currWaypoint.almostEqualXY(end);
    this.#calculate2dStep(start, end);

    // Move start to ground elevation if necessary.
    if ( this.elevationType(start) === ABOVE ) {
      const support = this.nearestSupport(start);
      currWaypoint = ElevatedPoint.fromLocationWithElevation(end, support.elevation);
      waypoints.push(currWaypoint);
    }

    const support = this.nearestSupport(currWaypoint);
    let currRegion = support.controllingRegion;

    /* Can we get there faster by burrowing?
    Track elevation changes:
    Anchors:
    - At start
    - At region intersection
    - Every move up

    Test anchors:
    - When moving down, test if we can get there faster using the anchor position.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor in case the regions connect/overlap.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
    const anchors = [0]; // O for the start index. Same if we move to ground.

    const MAX_ITER = 1000;
    let nIters = 0;
    while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;

      let type = this.elevationType(currWaypoint);
      // if ( type === GROUND && end.elevation <= currWaypoint.elevation ) type = BELOW;

      switch ( type ) {
        case BELOW: {
          currWaypoint = ElevatedPoint.fromLocationWithElevation(currWaypoint, currRegion[MODULE_ID].elevationUponEntry(currWaypoint)); // Move up.
          waypoints.push(currWaypoint);
          anchors.push(waypoints.length - 1);
          break;

          // Intersect the region, presumably from the inside.
//           const ixs = currRegion[MODULE_ID]._cutawayIntersections(currWaypoint, end);
//           if ( ixs.length > 1 ) {
//             ixs.sort((a, b) => a.t0 - b.t0);
//             currWaypoint = ixs[0];
//             if ( !finished() ) {
//               currWaypoint.add(this.#dir2d, currWaypoint); // Step ~1 pixel along the XY line.
//               const support = this.nearestSupport(currWaypoint);
//               currRegion = support.controllingRegion;
//             }
//             waypoints.push(currWaypoint);
//             break;
//           }
          // Fall through to GROUND b/c moving within the region gets us nowhere. (E.g., on ramp moving right.)
        }
        case GROUND: {
          // Follow region surface until hitting another region or falling.
          const walkResult = this._walkTerrainSurface(currWaypoint, end, currRegion, waypoints);
          if ( walkResult ) {
            const walkIx = this._walkIntersection(walkResult);
            if ( walkIx.region ) {  // Shouldn't this always be defined?
              currRegion = walkIx.region;
              currWaypoint = walkIx.ix;
              waypoints.push(currWaypoint);
              anchors.push(waypoints.length - 1);
            }
          } else {
            currWaypoint = waypoints.at(-1);
            if ( !finished() ) {
              currWaypoint.add(this.#dir2d, currWaypoint); // Step ~1 pixel along the XY line.
              const support = this.nearestSupport(currWaypoint);
              currRegion = support.controllingRegion;
            }
          }
          break;
        }
        case ABOVE: {
          // Fall to nearest support.
          currWaypoint = ElevatedPoint.fromLocationWithElevation(currWaypoint, currRegion[MODULE_ID].elevationUponEntry(currWaypoint)); // Move down.
          waypoints.push(currWaypoint);

          // Test anchors.
          // If can get from anchor to waypoint while always within at least one region, can burrow there.
          anchorLoop: for ( const [idx, anchor] of anchors.entries() ) {
            const a = waypoints[anchor];
            // Must remain within at least one region at all times.
            const regions = [...this.regions, canvas.scene].filter(r => {
              const loc = r[MODULE_ID].pointLocation(a);
              return loc === GROUND || loc === BELOW;
            });

            // Test each intersection to see if we are still within a region.
            // _cutawayIntersections will return the currWaypoint if it is within the region. Must test all between.
            const cutawayIxs = regions.flatMap(r => r[MODULE_ID]._cutawayIntersections(a, currWaypoint));
            cutawayIxs.sort((a, b) => a.x - b.x); // For cutaways, the x value functions as t0.
            // cutawayIxs.map(ix => cutaway.from2d(ix, a, currWaypoint))

            if ( !cutaway.from2d(cutawayIxs.at(-1), a, currWaypoint).almostEqual(currWaypoint) ) continue;
            let numInside = 0;
            for ( let i = 0, iMax = cutawayIxs.length - 1; i < iMax; i += 1 ) {
              cutawayIxs[i].movingInto ? numInside++ : numInside--;
              if ( numInside < 1 ) continue anchorLoop;
            }
            waypoints.splice(anchor+1);
            anchors.splice(idx);
            break;
          }

          anchors.push(waypoints.length - 1); // Possible to burrow from this new surface.
          break;
        }
      }
    }

    // Add in move vertically to end if we can.
    // Can span multiple regions.
//     if ( !currWaypoint.almostEqual(end) && this.elevationType(currWaypoint) !== ABOVE ) {
//       const support = this.nearestSupport(currWaypoint);
//       const cutawayIxs = support.controllingRegion[MODULE_ID]._cutawayIntersections(currWaypoint, end);
//
//       // Test each intersection to see if we are still within a region.
//
//
//       if ( cutawayIxs.length > 1 ) {
//         currWaypoint = ixs[0];
//         waypoints.push(currWaypoint);
//       }
//     }
    return waypoints;
  }

  /* Flying
  • Must not crash into a terrain region.
  • Can move diagonally to the top of a given terrain.
  • Walk along region surfaces if destination is at or below elevation.
  */
  _constructFlyingPath(start, end) {
    const { ABOVE, BELOW, GROUND } = this.constructor.ELEVATION_LOCATIONS;
    const waypoints = [start];
    let currWaypoint = start;
    this.#calculate2dStep(start, end);
    const finished = () => currWaypoint.almostEqualXY(end);

    // Move start to ground elevation if necessary.
    if ( this.elevationType(start) === BELOW ) {
      const res = this.nearestSupport(start);
      currWaypoint = ElevatedPoint.fromLocationWithElevation(end, res.supportElevation);
      waypoints.push(currWaypoint);
    }

    const support = this.nearestSupport(currWaypoint);
    let currRegion = support.controllingRegion;

    /* Can we get there faster by flying?
    Track elevation changes:
    Anchors:
    - At start
    - Every move down at the point prior to the down move, add anchor

    Test anchors:
    - When moving up, test if can get to the up location from an anchor faster.
    - If anchor is better, remove the intermediate waypoints. Keep the anchor.
    - The diagonal move replaces waypoints inbetween. So need to keep an index for the waypoints.
    */
    const anchors = [0]; // O for the start index. Same if we move to ground.

    const MAX_ITER = 1000;
    let nIters = 0;
    while ( !finished() && nIters < MAX_ITER ) {
      nIters += 1;
      let type = this.elevationType(currWaypoint);

      // If there is a direct path to the end, take it.
      // This addresses when the destination is above a ramp but below the current elevation.
      // (Standing at top of ramp; fly down instead of walking down ramp then flying straight up).

      /* Alternative: Just set to ABOVE, which will use flightIntersection.
      if ( type === GROUND && !this.regions.some(region => region[MODULE_ID].lineSegmentIntersects(currWaypoint, end)) ) {
        currWaypoint = end;
        waypoints.push(end);
        break;
      } */
      if ( type === GROUND
        && !this.regions.some(region => region[MODULE_ID].lineSegmentIntersects(currWaypoint, end)) ) type = ABOVE;

      switch ( type ) {
        case ABOVE: {
          // Get the next region intersection.
          const flightResult = this._flightIntersection(currWaypoint, end);
          if ( flightResult.region ) currWaypoint = flightResult.ix;
          else currWaypoint = end;
          waypoints.push(currWaypoint);
          break;
        }
        case GROUND: {
          // Follow region surface until hitting another region or falling.
          const walkResult = this._walkTerrainSurface(currWaypoint, end, currRegion, waypoints);
          if ( walkResult ) {
            const walkIx = this._walkIntersection(walkResult);
            if ( walkIx.region ) {  // Shouldn't this always be defined?
              currRegion = walkIx.region;
              currWaypoint = walkIx.ix;
              waypoints.push(currWaypoint);
            }
          } else {
            currWaypoint = waypoints.at(-1);
            if ( !finished() ) {
              currWaypoint.add(this.#dir2d, currWaypoint); // Step ~1 pixel along the XY line.
              const support = this.nearestSupport(currWaypoint);
              currRegion = support.controllingRegion;

              // At end of terrain surface; add anchor.
              anchors.push(waypoints.length - 1);
            }
          }
          break;
        }
        case BELOW: {
          currWaypoint = ElevatedPoint.fromLocationWithElevation(currWaypoint, currRegion[MODULE_ID].elevationUponEntry(currWaypoint)); // Move up.

          // Test if an anchor will get us there faster. Use the first viable anchor.
          for ( const [idx, anchor] of anchors.entries() ) {
            if ( this._flightIntersects(waypoints[anchor], currWaypoint, currRegion) ) return;
            waypoints.splice(anchor+1);
            anchors.splice(idx);
            break;
          }
          waypoints.push(currWaypoint);
          break;
        }
      }
    }

    // Add in move vertically to end if we can.
//     if ( !currWaypoint.almostEqual(end) && this.elevationType(currWaypoint) === ABOVE ) {
//       const support = this.nearestSupport(currWaypoint);
//       const ixs = support.controllingRegion[MODULE_ID]._cutawayIntersections(currWaypoint, end);
//       if ( ixs.length > 1 ) {
//         ixs.sort((a, b) => a.t0 - b.t0);
//         currWaypoint = ixs[0];
//         waypoints.push(currWaypoint);
//       }
//     }
    return waypoints;
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

  _flightIntersects(a, b, excludeRegion) {
    return this.regions.some(region => region !== excludeRegion && region[MODULE_ID].segmentIntersects(a, b));
  }

  _flightIntersection(a, b) {
    let closestRegion;
    let ix = { t0: Number.POSITIVE_INFINITY };
    this.regions.forEach(region => {
      const ixs = region[MODULE_ID].segmentIntersections(a, b);
      if ( !ixs.length ) return;
      ixs.sort((a, b) => a.t0 - b.t0);
      const regionIx = ixs[0];
      if ( regionIx.t0 >= ix.t0 ) return;
      closestRegion = region;
      ix = regionIx.t0;
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
    return LOCS.FLYING;
  }

  /**
   * Determine the nearest supporting object and its elevation from this point.
   * Could be a terrain region, tile, or scene floor.
   * If not burrowing, move up from burrowed terrain to floor of terrain.
   * @param {ElevatedPoint} waypoint              Location to test
   * @param {object} [opts]                       Options that affect the movement
   * @returns { priorType, regions, controllingRegion, elevation };
   */
  nearestSupport(waypoint, isEnd = false) {
    // If within 1+ regions, go to top of region unless burrowing.
    const LOCS = this.constructor.ELEVATION_LOCATIONS;
    const burrowRegions = [];
    const flyRegions = [];
    const groundRegions = [];
    for ( const region of [...this.regions, canvas.scene] ) {
      const type = region[MODULE_ID].pointLocation(waypoint);
      if ( type === LOCS.OUTSIDE ) continue;
      switch ( type ) {
        case LOCS.BURROWING: burrowRegions.push(region); break;
        case LOCS.GROUND: groundRegions.push(region); break;
        case LOCS.FLYING: flyRegions.push(region); break;
      }
    }
    const out = { type: null, regions: null, controllingRegion: null, elevation: waypoint.elevation }

    if ( burrowRegions.length ) {
      out.type = LOCS.BURROWING;
      out.regions = burrowRegions;
      const canBurrow = isEnd ? this.canEndBelow : this.burrowing;
      if ( canBurrow ) return out;

      // Move to top of highest region.
      burrowRegions.forEach(region => {
        const elev = region[MODULE_ID].elevationUponEntry(location);
        if ( elev > out.elevation ) {
          out.elevation = elev;
          out.controllingRegion = region;
        }
      });
      return out;
    }

    if ( groundRegions.length ) {
      out.type = LOCS.GROUND;
      out.regions = groundRegions;
      out.controllingRegion = groundRegions[0]; // Just pick the first one if multiple.
      // out.regions = groundRegions;
      return out;
    }

    // Must be above 1+ regions or a tile or the ground.
    // Pick the highest.
    out.type = LOCS.FLYING;
    out.controllingRegion = canvas.scene;
    out.supportingElevation = canvas.scene[MODULE_ID].sceneFloor;
    for ( const region of flyRegions ) {
      const regionE = region[MODULE_ID].elevationUponEntry(location);
      if ( regionE <= out.supportingElevation ) continue;
      out.elevation = regionE;
      out.controllingRegion = region;
    }

    // Draw a vertical line segment to test tile intersction
//     const end = ElevatedPoint.fromLocationWithElevation(waypoint, this.sceneFloor);
//     for ( const tile of this.tiles ) {
//       const tileE = tile.elevationE;
//       if ( tileE <= out.supportingElevation ) continue;
//       if ( !tile[MODULE_ID].lineSegmentIntersects(waypoint, end) ) continue;
//       out.supportingElevation = tileE;
//       out.controllingObject = tile;
//     }

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

  /**
   * Construct the 2d cutaway path if flying.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {StraightLinePath<RegionMovementWaypoint>} The 2d cutaway path based on concave hull
   */
  static _constructPathFlying(start2d, end2d, combinedPolys) {
    return this._convexPath(start2d, end2d, combinedPolys);
  }

  /**
   * Construct the 2d cutaway path if burrowing.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {StraightLinePath<RegionMovementWaypoint>} The 2d cutaway path based on concave hull
   */
  static _constructPathBurrowing(start2d, end2d, combinedPolys) {
    const invertedPolys = invertPolygons(combinedPolys);
    return this._convexPath(start2d, end2d, invertedPolys, true);
  }

  /**
   * Construct the 2d cutaway path if walking.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {StraightLinePath<PIXI.Point>} The 2d cutaway path based on concave hull
   */
  static _constructPathWalking(start2d, end2d, combinedPolys, { start, end } = {}) {
    // If starting position is floating or underground:
    // If it intersects a polygon to move towards end2d, set that as currEnd.
    // Otherwise move to terrain floor.
    const startType = cutawayElevationType(start2d, combinedPolys);
    const sceneFloor = gridUnitsToPixels(canvas.scene[MODULE_ID].sceneFloor);
    let currPosition = start2d;
    let currEnd = end2d;
    let currPoly = null;
    let currPolyIndex = -1;
    const waypoints = new StraightLinePath();
    if ( startType === this.ELEVATION_LOCATIONS.GROUND ) {
      // Determine what polygon we are on.
      const ixs = polygonsIntersections(
        { x: currPosition.x, y: currPosition.y + 1 },
        { x: currPosition.x, y: currPosition.y - 1 },
        combinedPolys);
      if ( ixs.length ) {
        const firstIx = ixs[0];
        currPosition = PIXI.Point.fromObject(firstIx);
        currPoly = firstIx.poly;
        currEnd = firstIx.edge.B;
        const currPolyPts = currPoly.pixiPoints({ close: false });
        currPolyIndex = currPolyPts.findIndex(pt => pt.almostEqual(currEnd));

        // Check if we intersected with the point; if so, move to next.
        if ( currPosition.almostEqual(currEnd) ) {
          currPolyIndex += 1;
          if ( currPolyIndex >= currPolyPts.length ) currPolyIndex = 0;
          currPosition = currEnd;
          currEnd = currPolyPts[currPolyIndex];
        }
      }

    // Floating or underground endpoint; if we intersect a polygon, keep end; otherwise move to scene floor
    // Underground points always hit a polygon b/c they are inside a polygon.
    } else if ( !(startType === this.ELEVATION_LOCATIONS.UNDERGROUND
               || segmentIntersectsPolygons(start2d, end2d, combinedPolys)) ) {
      currEnd = new PIXI.Point(start2d.x, sceneFloor);
    }

    // For each segment move, either circle around the current polygon or move in straight line toward end.
    const MAX_ITER = 1e04;
    let iter = 0;
    while ( iter < MAX_ITER ) {
      iter += 1;
      waypoints.push(currPosition);

      // 1. Are we at the end?
      if ( currPosition.almostEqual(currEnd) ) {
        currEnd = end2d;
        currPoly = null;
      }

      // 2. Is end moving us backwards? Move to scene floor or the intersecting polygon if moving up.
      // This can happen if the polygon is "floating" above the scene floor.
      if ( !currEnd.x.almostEqual(currPosition.x) && currEnd.x < currPosition.x ) {
        const prevPosition = waypoints.at(-2);
        const travelingUp = prevPosition ? prevPosition.y < currPosition.y : currPosition.y < currEnd.y;
        if ( travelingUp ) {
          const ixs = polygonsIntersections(currPosition, { x: currPosition.x, y: 1e06 }, combinedPolys);
          if ( ixs.length ) {
            const firstIx = ixs[0];
            currPosition = PIXI.Point.fromObject(firstIx);
            waypoints.push(currPosition);
            currPoly = firstIx.poly;
            currEnd = firstIx.edge.B;
            const currPolyPts = currPoly.pixiPoints({ close: false });
            currPolyIndex = currPolyPts.findIndex(pt => pt.almostEqual(currEnd));
          } else {
            currEnd = new PIXI.Point(currPosition.x, sceneFloor);
            currPoly = null;
          }
        } else {
          currEnd = new PIXI.Point(currPosition.x, sceneFloor);
          currPoly = null;
        }
      }

      // If this line intersects the end2d vertical, switch to that endpoint so we can finish.
      // B/c we are only walking, we can only intersect the end2d if it is on this ground level.
      // We cannot just move end2d at the beginning b/c we cannot be certain what level we are on.
      if ( currPosition.x === currEnd.x ) { // Vertical move or currPosition === currEnd
        if ( currEnd.x.almostEqual(end2d.x) && currPosition.y >= currEnd.y ) break; // Stop at the top.
      } else if ( currPosition.x.almostEqual(end2d.x) ) break;
      else if ( currEnd.x > end2d.x ) {
        // Non-vertical move. If it intersects the end2d vertical, swap out the endpoint.
        const ix = foundry.utils.lineLineIntersection(currPosition, currEnd, end2d, { x: end2d.x, y: end2d.y + 1 });
        currEnd.x = end2d.x;
        currEnd.y = ix?.y ?? currEnd.y; // Ix should always be defined, but...
      }

      // 3. Check for polygons between position and end.
      if ( !currPoly ) {
        const ixs = polygonsIntersections(currPosition, currEnd, combinedPolys, currPoly);
        if ( !ixs.length ) {
          currPosition = currEnd;
          continue;
        }
        // By definition, all ixs have x <= end2d.x and x <= currEnd.x
        const firstIx = ixs[0];
        currPosition = PIXI.Point.fromObject(firstIx);
        currPoly = firstIx.poly;
        currEnd = firstIx.edge.B;
        const currPolyPts = currPoly.pixiPoints({ close: false });
        currPolyIndex = currPolyPts.findIndex(pt => pt.almostEqual(currEnd));
        continue;
      }

      // 4. Cycle to the next point along the polygon edge.
      currPolyIndex += 1;
      if ( currPolyIndex >= currPoly.pixiPoints({ close: false }).length ) currPolyIndex = 0;
      currPosition = currEnd;
      currEnd = currPoly.pixiPoints({ close: false })[currPolyIndex];
    }
    if ( iter >= MAX_ITER ) console.error("constructPath|Iteration exceeded max iterations!", start ?? start2d, end ?? end2d);
    waypoints.at(-1).y = Math.round(waypoints.at(-1).y);
    return waypoints;
  }


  /**
   * Construct a 2d cutaway of the regions along a given line.
   * X-axis is the distance from the start point.
   * Y-axis is elevation. Note y increases as moving up, which is opposite of Foundry.
   * Only handles plateaus and ramps; ignores stairs.
   * @param {ElevatedPoint} start        Start of the path; cutaway will be extended 2 pixels before.
   * @param {ElevatedPoint} end          End of the path; cutaway will be extended 2 pixels after
   * @param {Region[]} regions                      Regions to test
   * @param {Tile[]} tiles                          Tiles to test
   * @param {Token} token                           Token doing the movement
   * @returns {PIXI.Polygon[]} Array of polygons representing the cutaway.
   */
  static _cutaway(start, end, { regions = [], tiles = [], token } = {}) {
    const cutaways = [];
    regions.forEach(region => cutaways.push(...region[MODULE_ID]._cutaway(start, end)));
    tiles.forEach(tile => tiles.push(...tile[MODULE_ID]._cutaway(start, end, token)));
    if ( !cutaways.length ) return [];

    // Wherever there is no cutaway or the cutaway is above the scene floor, draw a scene floor.
    // Leave open where cutaway is below to create holes.
    // Determine by examining the cutaways
    const MIN_ELEV = -1e06;
    const sceneFloor = canvas.scene[MODULE_ID].sceneFloor;

    // Determine every intersection point with the cutaways.
    // Intersection here just means the left and right bounds of the cutaway if the cutaway
    // is below or at the scene floor.

    const end2d = cutaway.to2d(end, start, end);
    const ixs = [];
    let inside = 0;
    for ( const cutaway of cutaways ) {
      const bounds = cutaway.getBounds();
      if ( bounds.top > sceneFloor ) continue; // Y is reversed, so this is bottom > sceneFloor.
      const isHole = !cutaway.isPositive;
      const { left, right } = bounds;
      if ( left > 0 ) ixs.push({ x: left, movingIn: true, isHole });
      else inside += (isHole ? -1 : 1); // Already inside cutaway.
      if ( right < end2d.x ) ixs.push({x: right, movingIn: false, isHole }); // Will exit before end.
    }

    // Construct path by walking the intersections, adding scene floor whenever not inside.
    const sceneFloorPolys = [];
    ixs.sort((a, b) => a.x - b.x);
    let prevX = 0;
    for ( const ix of ixs ) {
      if ( ix.isHole ^ ix.movingIn ) {
        // Moving into a normal polygon or moving out of a hole; implied move into a normal polygon..
        if ( inside <= 0 ) {
          const pts = [prevX, sceneFloor, prevX, MIN_ELEV, ix.x, MIN_ELEV, ix.x, sceneFloor];
          sceneFloorPolys.push(CutawayPolygon.fromCutawayPoints(pts, start, end));
        }
        inside += 1;
      } else {
        // Moving into a hole or moving out of a normal polygon.
        inside -= 1;
        if ( !inside ) prevX = ix.x;
      }
    }

    // If at end of the segment, can add a scene floor poly if not inside.
    if ( !inside && prevX < end2d.x ) {
      const pts = [prevX, sceneFloor, prevX, MIN_ELEV, end2d.x, MIN_ELEV, end2d.x, sceneFloor];
      sceneFloorPolys.push(CutawayPolygon.fromCutawayPoints(pts, start, end));
    }

    // Combine the cutaway polygons with the scene floor polygons.
    const path = ClipperPaths.fromPolygons([...cutaways, ...sceneFloorPolys]);
    const combinedPolys = path.combine().clean().toPolygons();

    // If all holes or no polygons, we are done.
    if ( !combinedPolys.length || combinedPolys.every(poly => poly.isHole) ) return [];
    return combinedPolys.map(poly => {
      // Strip duplicate points, which will cause problems later.
      const pts = [...poly.iteratePoints({ close: false })];
      let lastPt = pts[0];
      const deduped = [lastPt];
      for (let i = 1, n = pts.length; i < n; i += 1 ) {
        const pt = pts[i];
        if ( pt.almostEqual(lastPt) ) continue;
        deduped.push(pt);
        lastPt = pt;
      }
      return CutawayPolygon.fromCutawayPoints(deduped, start, end);
    });
  }


  /**
   * For a path, determine if it intersects 1+ polygons in the array.
   * Construct the convex hull and walk the path.
   * If it intersects with another polygon, build that convex hull and redo.
   * Until a clear path emerges to the goal.
   * TODO: Could also use pathfinding to get a direct flight path.
   * TODO: Could pathfind the inverted polygon shapes (pathfind inside the shapes) for burrowing.
   * TODO: Could invert the shapes for burrowing. Would the y index need to be inverted?
   * @param {PIXI.Point} start2d
   * @param {PIXI.Point} end2d
   * @param {PIXI.Polygon[]} polys
   * @returns {StraightLinePath<PIXI.Point>} The found path
   */
  static _convexPath(start2d, end2d, polys, inverted = false, iter = 0) {
    const ixs = polygonsIntersections(start2d, end2d, polys);
    if ( !ixs.length ) return StraightLinePath.from([start2d, end2d]);

    // Replace the polygon with a convex hull version.
    const ixPoly = ixs[0].poly;
    const hull = PIXI.Polygon.convexHull([start2d, ...ixPoly.pixiPoints({ close: false }), end2d]);

    // Walk the convex hull.
    // Orient the hull so that iterating the points or edges will move in the direction we want to go.
    const waypoints = new StraightLinePath();
    let walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
    if ( inverted ) walkDir = walkDir === "ccw" ? "cw" : "ccw";
    if ( hull.isClockwise ^ (walkDir === "cw") ) hull.reverseOrientation();
    const hullPts = hull.pixiPoints({ close: false });
    let currPolyIndex = hullPts.findIndex(pt => pt.almostEqual(start2d));
    let currPosition = start2d;
    currPolyIndex += 1;
    if ( !~currPolyIndex ) {
      // Start is between two points on the hull. Locate the one closest to start.
      let minDist2 = Number.POSITIVE_INFINITY;
      let minIndex = -1;
      let closestPoint;
      for ( let i = 1, n = hullPts.length; i < n; i += 1 ) {
        const a = hullPts[i - 1];
        const b = hullPts[i];
        const closest = foundry.utils.closestPointToSegment(start2d, a, b);
        const dist2 = PIXI.Point.distanceSquaredBetween(start2d, closest);
        if ( dist2 < minDist2 ) {
          minDist2 = dist2;
          minIndex = i;
          closestPoint = closest;
        }
      }

      closestPoint = PIXI.Point.fromObject(closestPoint);
      if ( !start2d.almostEqual(closestPoint) ) waypoints.push(start2d);
      currPosition = closestPoint;
      currPolyIndex = minIndex;
      if ( !~minIndex ) {
        console.error("convexPath|Start point not found in the convex polygon.");
        return StraightLinePath.from([start2d, end2d]);
      }
    }
    polys = polys.filter(poly => poly !== ixPoly);
    const MAX_ITER = 1e04;
    while ( currPosition.x < end2d.x && iter < MAX_ITER ) {
      iter += 1;
      if ( currPolyIndex >= hullPts.length ) currPolyIndex = 0;
      const nextPosition = hullPts[currPolyIndex];

      // Locate where the end vertical line hits our path.
      if ( nextPosition.x > end2d.x ) {
        const ix = foundry.utils.lineLineIntersection(currPosition, nextPosition, end2d,
          { x: end2d.x, y: end2d.y + 1 });
        nextPosition.x = end2d.x;
        nextPosition.y = ix.y;
      }

      if ( polys.length ) {
        const ixs = polygonsIntersections(currPosition, nextPosition, polys, hull);
        if ( ixs.length ) {
          // Create a convex hull for this new polygon.
          const ixPoly = ixs[0].poly;
          const ixHull = PIXI.Polygon.convexHull([currPosition, ...ixPoly.pixiPoints({ close: false }), end2d]);
          if ( ixHull.isClockwise ^ (walkDir === "cw") ) ixHull.reverseOrientation();

          // Combine and redo.
          polys = polys.filter(poly => poly !== ixPoly);
          const clipperPaths = ClipperPaths.fromPolygons([...polys, hull, ixHull]);
          const combinedPolys = clipperPaths.combine().clean().toPolygons();
          return this._convexPath(start2d, end2d, combinedPolys, inverted, iter);
        }
      }
      waypoints.push(currPosition);

      // If the next position does not move our position forward, skip.
      if ( !currPosition.x.almostEqual(nextPosition.x) ) currPosition = nextPosition;
      currPolyIndex += 1;
    }
    waypoints.push(end2d);
    if ( iter >= MAX_ITER ) console.error("convexPath|Iteration exceeded max iterations!", start2d, end2d);
    return waypoints;
  }


  // ----- NOTE: Cutaway methods ----- //

  /**
   * @typedef {PIXI.Point} CutawayPoint
   * A point in cutaway space.
   * @param {number} x      Distance-squared from start point
   * @param {number} y      Elevation in pixel units
   */

  /**
   * Convert a RegionMovementWaypoint to a cutaway coordinate.
   * @param {ElevatedPoint} waypoint
   * @param {ElevatedPoint} start
   * @param {ElevatedPoint} end
   * @returns {CutawayPoint}
   */
  static _to2dCutawayCoordinate(waypoint, start, end, outPoint) {
    if ( !instanceOrTypeOf(waypoint, ElevatedPoint) ) waypoint = ElevatedPoint.fromObject(waypoint);
    if ( !instanceOrTypeOf(start, ElevatedPoint) ) start = ElevatedPoint.fromObject(start);
    if ( !instanceOrTypeOf(end, ElevatedPoint) ) end = ElevatedPoint.fromObject(end);
    return cutaway.to2d(waypoint, start, end, outPoint);
  }

  /**
   * Convert a cutaway coordinate to a RegionMovementWaypoint.
   * @param {CutawayPoint} cutawayPt
   * @param {RegionMovementWaypoint} start
   * @param {RegionMovementWaypoint} end
   * @param {ElevatedPoint} outPoint                  Point to use for the return
   * @returns {ElevatedPoint} The outPoint
   */
  static _from2dCutawayCoordinate(cutawayPt, start, end, outPoint) {
    if ( !instanceOrTypeOf(start, ElevatedPoint) ) start = ElevatedPoint.fromObject(start);
    if ( !instanceOrTypeOf(end, ElevatedPoint) ) end = ElevatedPoint.fromObject(end);
    outPoint ??= new ElevatedPoint();
    cutaway.from2d(cutawayPt, start, end, outPoint);
    return outPoint;
  }


  // ----- NOTE: Basic Helper methods ----- //


  // ----- NOTE: Debugging ----- //

  /**
   * Draw at 0,0.
   * Flip y so it faces up.
   * Change the elevation dimension to match.
   * Set min elevation to one grid unit below the scene.
   */
  static drawCutawayPolygon(poly, opts = {}) {
    const { convertToDistance, convertToElevation } = cutaway;
    opts.color ??= Draw.COLORS.red;
    opts.fill ??= Draw.COLORS.red;
    opts.fillAlpha ??= 0.3;
    const invertedPolyPoints = [];
    const floor = gridUnitsToPixels(canvas.scene[MODULE_ID].sceneFloor- canvas.dimensions.distance);
    for ( let i = 0, n = poly.points.length; i < n; i += 2 ) {
      const x = poly.points[i];
      const y = poly.points[i+1];
      const pt = { x, y: -Math.max(floor, y) };

      // Convert to smaller values for displaying.
      convertToDistance(pt);
      convertToElevation(pt);
      invertedPolyPoints.push(pt);
    }
    const invertedPoly = new PIXI.Polygon(...invertedPolyPoints);
    Draw.shape(invertedPoly, opts);
  }

  /**
   * Draw the path from constructPath using the cutaway coordinates.
   * For debugging against the cutaway polygon.
   */
  static drawCutawayPath(path, opts = {}) {
    const { convertToDistance, convertToElevation } = cutaway;
    opts.color ??= Draw.COLORS.blue;
    const start = path[0];
    const end = path.at(-1);
    for ( let i = 1, n = path.length; i < n; i += 1 ) {
      const a = path[i - 1];
      const b = path[i];
      const a2d = this._to2dCutawayCoordinate(a, start, end);
      const b2d = this._to2dCutawayCoordinate(b, start, end);

      // Convert to smaller values for displaying.
      convertToDistance(a2d);
      convertToDistance(b2d);
      convertToElevation(a2d);
      convertToElevation(b2d);

      // Invert the y value for display.
      a2d.y = -a2d.y;
      b2d.y = -b2d.y;
      Draw.segment({ A: a2d, B: b2d }, opts);
    }
  }


  static drawRegionMovement(segments) {
    for ( const segment of segments ) this.#drawRegionSegment(segment);
  }

  static #drawRegionSegment(segment) {
    const TYPES = CONFIG.Region.objectClass.MOVEMENT_SEGMENT_TYPES;
    const color = segment.type === TYPES.ENTER
      ? Draw.COLORS.green
      : segment.type === TYPES.MOVE ? Draw.COLORS.orange
        : Draw.COLORS.red;
    const A = segment.from;
    const B = segment.to;
    Draw.point(A, { color });
    Draw.point(B, { color });
    Draw.segment({ A, B }, { color });
  }

  /**
   * Draw cutaway of the region segments.
   */
  static drawRegionMovementCutaway(segments) {
    const pathWaypoints = RegionElevationHandler.fromSegments(segments);
    this.drawRegionPathCutaway(pathWaypoints);
  }

  /**
   * For debugging.
   * Draw line segments on the 2d canvas connecting the 2d parts of the path.
   * @param {PathArray<RegionMoveWaypoint>} path
   */
  static drawRegionPath(path, { color } = {}) {
    color ??= Draw.COLORS.blue;
    for ( let i = 1; i < path.length; i += 1 ) {
      const A = path[i - 1];
      const B = path[i];
      Draw.point(A, { color });
      Draw.point(B, { color });
      Draw.segment({ A, B }, { color });
    }
  }

  /**
   * For debugging.
   * Draw line segments representing a cut-away of the path, where
   * 2d distance is along the x and elevation is y. Starts at path origin.
   * @param {PathArray<RegionMoveWaypoint>} path
   */
  static drawRegionPathCutaway(path) {
    const color = Draw.COLORS.red;
    const start = path[0];
    const nSegments = path.length;
    const cutaway = Array(nSegments);
    for ( let i = 0; i < nSegments; i += 1 ) {
      const p = path[i];
      cutaway[i] = new PIXI.Point(PIXI.Point.distanceBetween(start, p), -gridUnitsToPixels(p.elevation));
    }

    // Rotate the cutaway to match the path angle then translate to start.
    const end = path.at(-1);
    let angle = Math.atan2(end.y - start.y, end.x - start.x);
    if ( angle > Math.PI_1_2 || angle < -Math.PI_1_2 ) {
      cutaway.forEach(p => p.y = -p.y);
    }

    const mRot = MatrixFlat.rotationZ(angle, false);
    const delta = {...path[0]};
    cutaway.forEach(p => {
      const tmp = mRot.multiplyPoint2d(p).add(delta);
      p.copyFrom(tmp);
    });

    this.drawRegionPath(cutaway, { color });
    return cutaway;
  }

  /**
   * Token is flying if the start and end points are floating or it has a system-specific flying status.
   * @param {Token} token                     Token doing the movement
   * @param {RegionMovementWaypoint} start    Starting location
   * @param {RegionMovementWaypoint} end      Ending location
   * @returns {boolean} True if token has flying status or implicitly is flying
   */
  static tokenIsFlying(token, start, end) {
    if ( this.elevationType(start, token) === this.ELEVATION_LOCATIONS.FLOATING
      && this.elevationType(end, token) === this.ELEVATION_LOCATIONS.FLOATING ) return true;
    if ( game.system.id === "dnd5e" && token.actor ) return token.actor.statuses.has("flying") || token.actor.statuses.has("hovering");
    return false;
  }

  /**
   * Token is burrowing if the start and end points are underground or it has a system-specific burrowing status.
   * @param {Token} token                     Token doing the movement
   * @param {RegionMovementWaypoint} start    Starting location
   * @param {RegionMovementWaypoint} end      Ending location
   * @returns {boolean} True if token has flying status or implicitly is flying
   */
  static tokenIsBurrowing(token, start, end) {
    if ( this.elevationType(start, token) === this.ELEVATION_LOCATIONS.UNDERGROUND
      && this.elevationType(end, token) === this.ELEVATION_LOCATIONS.UNDERGROUND) return true;
    if ( game.system.id === "dnd5e" && token.actor ) return token.actor.statuses.has("burrowing");
    return false;
  }

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
    for ( let i = 1; i < nPts; i += 1 ) Draw.segment({ a: cutawayPath[i - 1], b: cutawayPath[i] }, drawOpts);
    Draw.connectPoints(cutawayPath, drawOpts);
    cutawayPath.forEach(pt => Draw.point(pt, drawOpts))
  }
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
      ixs.push(ix);
    });
  });
  ixs.sort((a, b) => a.t0 - b.t0);
  return ixs;
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
  const locs = ElevationHandlerV2.ELEVATION_LOCATIONS;
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

