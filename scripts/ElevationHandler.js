/* globals
canvas,
CONFIG,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import {
  elevatedRegions,
  elevatedTiles,
  log } from "./util.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { RegionElevationHandler } from "./regions/RegionElevationHandler.js";
import { StraightLinePath } from "./StraightLinePath.js";
import { RegionMovementWaypoint3d } from "./geometry/3d/RegionMovementWaypoint3d.js";
import { instanceOrTypeOf, gridUnitsToPixels, cutaway } from "./geometry/util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";
import { Draw } from "./geometry/Draw.js";
import { MatrixFlat } from "./geometry/MatrixFlat.js";

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Also handles elevated tile "floors".
 */
export class ElevationHandler {

  // Null constructor.

  /** @type {enum: number} */
  static ELEVATION_LOCATIONS = {
    UNDERGROUND: 0,
    GROUND: 1,
    FLOATING: 2
  };

  // ----- NOTE: Getters ----- //

  /** @type {Region[]} */
  static get elevatedRegions() { return elevatedRegions(); }

  /** @type {Tile[]} */
  static get elevatedTiles() { return elevatedTiles(); }

  /** @type {number} */
  static get sceneFloor() { return canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0; }

  // ----- NOTE: Primary methods ----- //

  /**
   * Retrieve tiles and regions that may intersect a line segment. Bounds test only.
   * @param {Point} start          Start of the path
   * @param {Point} end            End of the path
   * @param {object} [opts]
   * @param {Region[]} [opts.regions]               Regions to test; if undefined all on canvas will be tested
   * @param {Region[]} [opts.tiles]               Tiles to test; if undefined all on canvas will be tested
   * @returns {object}
   *   @prop {Region[]} regions   Elevated regions that may intersect
   *   @prop {Tile[]} tiles       Elevated tiles that may intersect
   */
  static elevatedObjectsBoundLineSegment(start, end, { regions, tiles } = {}) {
    regions = elevatedRegions(regions).filter(region =>
      region.bounds.lineSegmentIntersects(start, end, { inside: true }));
    tiles = elevatedTiles(tiles).filter(tile => tile.bounds.lineSegmentIntersects(start, end, { inside: true }));
    return { regions, tiles };
  }

  /**
   * Retrieve terrain regions that may intersect a line segment. Bounds test only.
   * @param {Point} start          Start of the path
   * @param {Point} end             End of the path
   * @param {object} [opts]
   * @param {Region[]} [opts.regions]               Regions to test; if undefined all on canvas will be tested
   * @returns {Region[]} Terrain regions that may intersect.
   */
  static terrainRegionsBoundLineSegment(start, end, { regions } = {}) {
    regions ??= canvas.regions.placeables;
    return regions.filter(region =>
      region[MODULE_ID].hasTerrain && region.bounds.lineSegmentIntersects(start, end, { inside: true }));
  }

  /**
   * Simple test for whether any terrain regions may intersect a line segment. Bounds test only.
   * @param {Ppoint} start          Start of the path
   * @param {Point} end             End of the path
   * @param {object} [opts]
   * @param {Region[]} [opts.regions]               Regions to test; if undefined all on canvas will be tested
   * @returns {boolean} True if at least one region found.
   */
  static anyTerrainRegionsBoundLineSegment(start, end, { regions } = {}) {
    regions ??= canvas.regions.placeables;
    return regions.some(region =>
      region[MODULE_ID].hasTerrain && region.bounds.lineSegmentIntersects(start, end, { inside: true }));
  }

  /**
   * Create a path for a given straight line segment that may move through regions.
   * Unless flying or burrowing, the path will run along the "top" of any ramp or plateau,
   * with the token moving up to the plateau/ramp elevations and down when exiting regions.
   *
   * Flying/burrowing rules:
   * • Flying:
   *   - True: Don't reduce elevation.
   *   - False: Move vertically to nearest supporting floor.
   *   - Undefined (implicit): If floating at start, fly until at a supporting floor.
   * • Burrowing: move directly through regions.
   *   - True: Move through regions instead of walking on supporting floors.
   *   - False: Move vertically to nearest supporting floor.
   *   - Undefined (implicit): If burrowing at start, burrow until at a supporting floor.
   *
   * Internally, it accomplishes this by constructing a 2d model of the regions that intersect the line.
   * x-axis: dist2 from the start, y-axis: elevation.
   * Then uses Clipper to combine the polygons.
   * Finally, constructs the path using the polygons(s).
   * @param {RegionMovementWaypoint} start          Start of the path
   * @param {RegionMovementWaypoint} end            End of the path
   * @param {object} [opts]                         Options that affect how movement is treated
   * @param {Region[]} [opts.regions]               Regions to test; if undefined all on canvas will be tested
   * @param {Region[]} [opts.tiles]               Tiles to test; if undefined all on canvas will be tested
   * @param {boolean} [opts.flying]                 If true, token is assumed to fly, not fall, between regions
   * @param {boolean} [opts.burrowing]              If true, token is assumed to burrow straight through regions
   * @param {Point[]} [opts.samples]                Passed to Region#segmentizeMovement
   * @returns {StraightLinePath<RegionMovementWaypoint3d>}   Sorted points by distance from start.
   */
  static constructPath(start, end, { regions, tiles, flying, burrowing, samples, token } = {}) {
    if ( !instanceOrTypeOf(start, RegionMovementWaypoint3d) ) start = RegionMovementWaypoint3d.fromObject(start);
    if ( !instanceOrTypeOf(end, RegionMovementWaypoint3d) ) end = RegionMovementWaypoint3d.fromObject(end);

    // If the start and end are equal, we are done.
    // If flying and burrowing, essentially a straight shot would work.
    if ( start.equals(end) || (flying && burrowing) ) return StraightLinePath.from([start, end]);

    // Only care about elevated regions and elevated tiles.
    // Trim to regions and tiles whose bounds are intersected by the path.
    // Don't worry about elevation right now.
    const res = this.elevatedObjectsBoundLineSegment(start, end, { regions, tiles });
    regions = res.regions;
    tiles = res.tiles;
    if ( !regions.length && !tiles.length ) return StraightLinePath.from([start, end]);

    // Simple case: Elevation-only change.
    // Only question is whether the end will be reset to ground.
    const { FLOATING, UNDERGROUND } = this.ELEVATION_LOCATIONS;
    const endType = this.elevationType(end, token, regions, tiles);
    if ( start.equalXY(end) ) {
      if ( (flying === false && endType === FLOATING)
        || (burrowing === false && endType === UNDERGROUND) ) {
        end.elevation = this.nearestGroundElevation(end, { regions, tiles, samples, burrowing });
      }
      return StraightLinePath.from([start, end]);
    }

    // Locate all polygons within each region that are intersected.
    // Construct a polygon representing the cutaway.
    samples ??= [{x: 0, y: 0}];
    const combinedPolys = this._cutaway(start, end, { regions, tiles, token });
    if ( !combinedPolys.length ) return StraightLinePath.from([start, end]);

    // Convert start and end to 2d-cutaway coordinates.
    const start2d = this._to2dCutawayCoordinate(start, start, end);
    const end2d = this._to2dCutawayCoordinate(end, start, end );

    // Clipper will end up rounding the polygon points to integers.
    // To ensure the end can be reached from the terrain floor, round end2d down.
    end2d.x = Math.floor(end2d.x);

    // Orient the polygons so that iterating the points or edges will move in the direction we want to go.
    const walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
    combinedPolys.forEach(poly => {
      if ( poly.isClockwise ^ (walkDir === "cw") ) poly.reverseOrientation();
    });

    // Walk around the polygons or convex version of polygons for burrowing/flying.
    const fnName = flying ? "_constructPathFlying" : burrowing ? "_constructPathBurrowing" : "_constructPathWalking";
    if ( flying && endType !== FLOATING ) {
      const endE = this.nearestGroundElevation(end, { regions, samples });
      end2d.y = gridUnitsToPixels(endE);
    }
    if ( burrowing && endType !== UNDERGROUND ) {
      const endE = this.nearestGroundElevation(end, { regions, samples });
      end2d.y = gridUnitsToPixels(endE);
    }
    const waypoints = this[fnName](start2d, end2d, combinedPolys, { start, end });

    // Undo rounding of the end point.
    const endWaypoint = waypoints.at(-1);
    if ( end2d.x.almostEqual(endWaypoint.x, 0.51) ) endWaypoint.x = end2d.x;

    // Convert back to regular coordinates.
    return waypoints.map(waypoint => this._from2dCutawayCoordinate(waypoint, start, end));
  }

  /**
   * Determine if a given location is on the terrain floor, on a plateau/ramp, in the air, or
   * inside an elevated terrain or tile.
   * To be on the ground, it has to be on the region's plateau and not within another region unless it
   * is also on that other region's plateau.
   * Or at a tile elevation.
   * @param {RegionMovementWaypoint3d} waypoint     Location to test
   * @param {Token} [token]                       Token doing the movement; used to test tile holes
   * @param {Region[]} [regions]                  Regions to consider; otherwise entire canvas
   * @param {Tile[]} [tiles]                      Tiles to consider; otherwise entire canvas
   * @returns {ELEVATION_LOCATIONS}
   */
  static elevationType(waypoint, token, regions, tiles) {
    if ( !instanceOrTypeOf(waypoint, RegionMovementWaypoint3d) ) waypoint = RegionMovementWaypoint3d.fromObject(waypoint);

    const locs = this.ELEVATION_LOCATIONS;
    tiles = elevatedTiles(tiles);
    for ( const tile of tiles ) {
      if ( tile[MODULE_ID].waypointOnTile(waypoint, token) ) return locs.GROUND;
    }

    // Not inside a region (2d): floating if above ground; burrowing if below.
    // Single region: Floating if not at elevationUponEntry.
    // Multiple regions: Floating if not at highest elevationUponEntry (recall all plateaus are solids).
    regions = elevatedRegions(regions);
    let inside = false;
    let highestElevation = Number.NEGATIVE_INFINITY;
    for ( const region of regions ) {
      if ( !region.testPoint(waypoint) ) continue; // No elevation test.
      inside ||= true;
      highestElevation = Math.max(highestElevation, region[MODULE_ID].elevationUponEntry(waypoint));
    }
    if ( inside ) {
      if ( waypoint.elevation.almostEqual(highestElevation) ) return locs.GROUND;
      return waypoint.elevation > highestElevation ? locs.FLOATING : locs.UNDERGROUND;
    }
    if ( waypoint.elevation.almostEqual(this.sceneFloor) ) return locs.GROUND;
    return waypoint.elevation > this.sceneFloor ? locs.FLOATING : locs.UNDERGROUND;
  }


  /**
   * From the provided position, determine the highest supporting "floor".
   * This could be a plateau, ramp, or the scene floor.
   * @param {RegionMovementWaypoint3d} waypoint     The location to test
   * @param {Region[]} regions                    Regions to consider
   * @param {object} [opts]                       Options that affect the movement
   * @param {Region[]} [opts.regions]             Regions to test; if undefined all on canvas will be tested
   * @param {Tile[]} [opts.tiles]                 Tiles to test; if undefined all on canvas will be tested
   * @param {Point[]} [opts.samples]              Passed to Region#segmentizeMovement
   * @param {boolean} [opts.burrowing]            If true, will fall but not move up if already in region
   * @returns {number} The elevation for the nearest ground, in grid units
   */
  static nearestGroundElevation(waypoint, { regions, tiles, samples, burrowing = false, token } = {}) {
    if ( !instanceOrTypeOf(waypoint, RegionMovementWaypoint3d) ) waypoint = RegionMovementWaypoint3d.fromObject(waypoint);

    const teleport = false;
    samples ??= [{x: 0, y: 0}];
    regions = elevatedRegions(regions);
    tiles = elevatedTiles(tiles);
    const terrainFloor = this.sceneFloor;
    let currElevation = waypoint.elevation;

    // Option 1: Waypoint is currently on a tile.
    if ( tiles.some(tile => tile[MODULE_ID].waypointOnTile(waypoint, token)) ) return waypoint.elevation;

    // Option 2: Waypoint is currently in a region.
    const currRegions = regions.filter(region => region.testPoint(waypoint, currElevation));
    if ( burrowing && currRegions.length ) return currElevation;

    // Option 3: Fall to ground and locate intersecting regions and tiles. If below ground, move up to ground.
    if ( !currRegions.length ) {
      if ( waypoint.elevation === terrainFloor ) return terrainFloor;
      const ixs = [];
      const start = waypoint;
      const end = RegionMovementWaypoint3d.fromLocationWithElevation(waypoint, terrainFloor);
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
    let currRegionElevation = currElevation;
    let maxElevation = currElevation;
    do {
      iter += 1;
      currRegionElevation = maxElevation;
      maxElevation = Number.NEGATIVE_INFINITY;
      for ( const region of regions ) {
        if ( !region.testPoint(waypoint, currRegionElevation) ) continue;
        const newE = region[MODULE_ID].elevationUponEntry(waypoint);
        maxElevation = Math.max(maxElevation, newE);
      }
    } while ( maxElevation !== currRegionElevation && iter < MAX_ITER );
    if ( iter >= MAX_ITER ) console.error("nearestGroundElevation|Max iterations reached!", waypoint);

    return isFinite(currRegionElevation) ? currRegionElevation : currElevation;
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
    const sceneFloor = gridUnitsToPixels(this.sceneFloor);
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
   * @param {RegionMovementWaypoint3d} start        Start of the path; cutaway will be extended 2 pixels before.
   * @param {RegionMovementWaypoint3d} end          End of the path; cutaway will be extended 2 pixels after
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
    const sceneFloor = this.sceneFloor;

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
    if ( !combinedPolys.length || combinedPolys.every(poly => !poly.isPositive) ) return [];
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
   * @param {RegionMovementWaypoint3d} waypoint
   * @param {RegionMovementWaypoint3d} start
   * @param {RegionMovementWaypoint3d} end
   * @returns {CutawayPoint}
   */
  static _to2dCutawayCoordinate(waypoint, start, end, outPoint) {
    if ( !instanceOrTypeOf(waypoint, RegionMovementWaypoint3d) ) waypoint = RegionMovementWaypoint3d.fromObject(waypoint);
    if ( !instanceOrTypeOf(start, RegionMovementWaypoint3d) ) start = RegionMovementWaypoint3d.fromObject(start);
    if ( !instanceOrTypeOf(end, RegionMovementWaypoint3d) ) end = RegionMovementWaypoint3d.fromObject(end);
    return cutaway.to2d(waypoint, start, end, outPoint);
  }

  /**
   * Convert a cutaway coordinate to a RegionMovementWaypoint.
   * @param {CutawayPoint} cutawayPt
   * @param {RegionMovementWaypoint} start
   * @param {RegionMovementWaypoint} end
   * @param {RegionMovementWaypoint3d} outPoint                  Point to use for the return
   * @returns {RegionMovementWaypoint3d} The outPoint
   */
  static _from2dCutawayCoordinate(cutawayPt, start, end, outPoint) {
    if ( !instanceOrTypeOf(start, RegionMovementWaypoint3d) ) start = RegionMovementWaypoint3d.fromObject(start);
    if ( !instanceOrTypeOf(end, RegionMovementWaypoint3d) ) end = RegionMovementWaypoint3d.fromObject(end);
    outPoint ??= new RegionMovementWaypoint3d();
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
    const floor = gridUnitsToPixels(ElevationHandler.sceneFloor - canvas.dimensions.distance);
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
  const locs = ElevationHandler.ELEVATION_LOCATIONS;
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

