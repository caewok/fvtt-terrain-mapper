/* globals
canvas,
CONFIG,
foundry,
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "../const.js";
import {
  elevatedRegions,
  regionWaypointsEqual,
  regionWaypointsXYEqual } from "../util.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { RegionElevationHandler } from "./RegionElevationHandler.js";

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Encapsulated inside Region.terrainmapper static class
 */
export class RegionsElevationHandler {

  // Null constructor.

  /** @type {enum: number} */
  static ELEVATION_LOCATIONS = {
    UNDERGROUND: 0,
    GROUND: 1,
    FLOATING: 2
  }

  // ----- NOTE: Getters ----- //

  /** @type {Region[]} */
  get elevatedRegions() { return elevatedRegions(); }

  /** @type {number} */
  get sceneFloor() { return canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0 }


  // ----- NOTE: Primary methods ----- //

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
   * @param {boolean} [opts.flying]                 If true, token is assumed to fly, not fall, between regions
   * @param {boolean} [opts.burrowing]              If true, token is assumed to burrow straight through regions
   * @param {Point[]} [opts.samples]                Passed to Region#segmentizeMovement
   * @returns {PathArray<RegionMovementWaypoint>}   Sorted points by distance from start.
   */
  constructRegionsPath(start, end, { regions, flying, burrowing, samples } = {}) {
    // If the start and end are equal, we are done.
    // If flying and burrowing, essentially a straight shot would work.
    if ( regionWaypointsEqual(start, end) || (flying && burrowing) ) return [start, end];

    // Only care about elevated regions.
    regions = elevatedRegions(regions);
    if ( !regions.length ) return [start, end];

    // Trim to regions whose bounds are intersected by the path.
    regions = regions.filter(region => region.bounds.lineSegmentIntersects(start, end, { inside: true }));

    // Check if the end point should be moved.
    const { FLOATING, UNDERGROUND } = this.constructor.ELEVATION_LOCATIONS;
    const endType = this.elevationType(end, regions);

    // Simple case: Elevation-only change.
    // Only question is whether the end will be reset to ground.
    if ( regionWaypointsXYEqual(start, end) ) {
      if ( (flying === false && endType === FLOATING)
        || (burrowing === false && endType === UNDERGROUND) ) {
        const endE = this.nearestGroundElevation(end, { regions, samples, burrowing });
        end = { x: end.x, elevation: endE };
      }
      return [start, end];
    }

    // Locate all polygons within each region that are intersected.
    // Construct a polygon representing the cutaway.
    samples ??= [{x: 0, y: 0}];
    const combinedPolys = this._regions2dCutaway(start, end, regions);
    if ( !combinedPolys.length ) return [start, end];

    // Convert start and end to 2d-cutaway coordinates.
    const start2d = this._to2dCutawayCoordinate(start, start);
    const end2d = this._to2dCutawayCoordinate(end, start);

    // Clipper will end up rounding the polygon points to integers.
    // To ensure the end can be reached from the terrain floor, round end2d down.
    end2d.x = Math.floor(end2d.x)

    // Orient the polygons so that iterating the points or edges will move in the direction we want to go.
    const walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
    combinedPolys.forEach(poly => {
      if ( poly.isClockwise ^ (walkDir === "cw") ) poly.reverseOrientation();
    });

    /*

    poly.contains:
    - Does not contain point on bottom or right of a polygon. Does contain left and top.
    - This is inverted here, so poly does not contain point on top or left; does contain right and bottom.
    - So on ground will not be contained. Might be contained on the ramp.

    poly.lineSegmentIntersects:
    - Intersects if hits top, left, right, bottom.

    poly.segmentIntersections
    -  Intersects if hits top, left, right, bottom.

    poly.linesCross:
    - Intersects if hits top, left, right, bottom. But only if not hitting at endpoint.

    Underground: contained in polygon
    Above ground: not contained and not on edge. pointOnPolygonEdge
    On ground: pointOnPolygonEdge

    Each loop:


    Ground floor: On the terrain floor: end is { x: end.x, y: terrainFloor }
    Ground: On a polygon edge: end is next endpoint.
      - If the end is higher, go there.
      - If the end is lower, go there unless end is backwards or flying.

    */

    // Walk around the polygons or convex version of polygons for burrowing/flying.
    const fnName = flying ? "_constructRegionsPathFlying" : burrowing ? "_constructRegionsPathBurrowing" : "_constructRegionsPathWalking";
    if ( flying && endType === UNDERGROUND ) {
      const endE = this.nearestGroundElevation(end, { regions, samples });
      end2d.y = endE;
    }
    if ( burrowing && endType === FLOATING ) {
      const endE = this.nearestGroundElevation(end, { regions, samples });
      end2d.y = endE;
    }
    const waypoints = this[fnName](start2d, end2d, combinedPolys, { start, end });

    // Undo rounding of the end point.
    const endWaypoint = waypoints.at(-1);
    if ( end2d.x.almostEqual(endWaypoint.x, 0.51) ) endWaypoint.x = end2d.x;

    // Add move endpoint depending on movement type.
//     if ( !regionWaypointsEqual(currPosition, currEnd)
//       && ((flying !== false && endType === FLOATING)
//        || (burrowing !== false && endType === UNDERGROUND)) ) waypoints.push(end2d);

    // Convert back to regular coordinates.
    return waypoints.map(waypoint => this._from2dCutawayCoordinate(waypoint, start, end));
  }

  /**
   * Determine if a given location is on the terrain floor, on a plateau/ramp, in the air, or
   * inside an elevated terrain.
   * To be on the ground, it has to be on the region's plateau and not within another region unless it
   * is also on that other region's plateau.
   * @param {RegionMovementWaypoint} waypoint     Location to test
   * @param {Region[]} [regions]                  Regions to consider; otherwise entire canvas
   * @returns {ELEVATION_LOCATIONS}
   */
  elevationType(waypoint, regions) {
    regions = elevatedRegions(regions);
    let inside = false;
    let offPlateau = false;
    for ( const region of regions ) {
      if ( !region.testPoint(waypoint, waypoint.elevation) ) continue;
      inside ||= true;
      if ( region[MODULE_ID].elevationUponEntry(waypoint) !== waypoint.elevation ) {
        offPlateau = true;
        break;
      }
    }

    const locs = this.constructor.ELEVATION_LOCATIONS;
    if ( inside && offPlateau ) return locs.UNDERGROUND;
    if ( inside && !offPlateau ) return locs.GROUND;
    if ( !inside && waypoint.elevation === this.sceneFloor ) return locs.GROUND;
    return locs.FLOATING;
  }


  /**
   * From the provided position, determine the highest supporting "floor".
   * This could be a plateau, ramp, or the scene floor.
   * @param {RegionMovementWaypoint} waypoint     The location to test
   * @param {Region[]} regions                    Regions to consider
   * @param {object} [opts]                       Options that affect the movement
   * @param {Region[]} [opts.regions]             Regions to test; if undefined all on canvas will be tested
   * @param {Point[]} [opts.samples]              Passed to Region#segmentizeMovement
   * @param {boolean} [opts.burrowing]            If true, will fall but not move up if already in region
   * @returns {number} The elevation for the nearest ground.
   */
  nearestGroundElevation(waypoint, { regions, samples, burrowing = false } = {}) {
    const teleport = false;
    samples ??= [{x: 0, y: 0}];
    regions = elevatedRegions(regions);
    const terrainFloor = this.sceneFloor;
    let currElevation = waypoint.elevation;

    // Option 1: Waypoint is currently in a region.
    const currRegions = regions.filter(region => region.testPoint(waypoint, currElevation));
    if ( burrowing && currRegions.length ) return currElevation;

    // Option 2: Fall to ground and locate intersecting region(s). If below ground, move up to ground.
    if ( !currRegions.length ) {
      if ( waypoint.elevation === terrainFloor ) return terrainFloor;
      const regionsIxs = [];
      const waypoints = [waypoint, { ...waypoint, elevation: terrainFloor }];
      for ( const region of regions ) {
        // Given the previous test, it would have to be an entry at this point.
        const segments = region.segmentizeMovement(waypoints, samples, { teleport });
        if ( !segments.length ) continue;
        const segment = segments[0];
        if ( segment.type !== Region.MOVEMENT_SEGMENT_TYPES.ENTER ) continue;
        segment.to.region = region;
        segment.to.dist = currElevation - segment.to.elevation;
        regionsIxs.push(segment.to);
      }
      // If no regions intersected, the terrain floor is the default.
      if ( !regionsIxs.length ) return terrainFloor;

      // Move to the first intersection and then to the top of the plateau.
      regionsIxs.sort((a, b) => a.dist - b.dist);
      const firstIx = regionsIxs[0];
      const newE = firstIx.region[MODULE_ID].elevationUponEntry(waypoint);
      currElevation = newE;
    }
    if ( burrowing ) return currElevation;

    // Get the entry elevation for each region in turn. Take the highest.
    // If the entry elevation changes the current elevation, repeat.
    const MAX_ITER = 1e04;
    let iter = 0;
    let maxElevation = currElevation;
    do {
      iter += 1;
      currElevation = maxElevation;
      maxElevation = Number.NEGATIVE_INFINITY;
      for ( const region of regions ) {
        if ( !region.testPoint(waypoint, currElevation) ) continue;
        const newE = region[MODULE_ID].elevationUponEntry(waypoint);
        maxElevation = Math.max(maxElevation, newE);
      }
    } while ( maxElevation !== currElevation && iter < MAX_ITER )

    if ( iter >= MAX_ITER ) console.error("nearestGroundElevation|Max iterations reached!", waypoint);
    return currElevation;
  }


  // ----- NOTE: Secondary methods ----- //

  /**
   * Construct the 2d cutaway path if flying.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {PIXI.Point[]} The 2d cutaway path based on concave hull
   */
  _constructRegionsPathFlying(start2d, end2d, combinedPolys) {
    return this._convexPath(start2d, end2d, combinedPolys);
  }

  /**
   * Construct the 2d cutaway path if burrowing.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {PIXI.Point[]} The 2d cutaway path based on concave hull
   */
  _constructRegionsPathBurrowing(start2d, end2d, combinedPolys) {
    const invertedPolys = invertPolygons(combinedPolys);
    return this._convexPath(start2d, end2d, invertedPolys, true);
  }

  /**
   * Construct the 2d cutaway path if walking.
   * @param {PIXI.Point} start2d                Cutaway start position
   * @param {PIXI.Point} end2d                  Cutaway end position
   * @param {PIXI.Polygon[]} combinedPolys      Union of cutaway polygons
   * @returns {PIXI.Point[]} The 2d cutaway path based on concave hull
   */
  _constructRegionsPathWalking(start2d, end2d, combinedPolys, { start, end } = {}) {
    // If starting position is floating or underground, add a move to the terrain floor.
    const startType = cutawayElevationType(start2d, combinedPolys);
    const sceneFloor = this.sceneFloor;
    let currPosition = start2d;
    let currEnd = end2d;
    const { FLOATING, UNDERGROUND } = this.constructor.ELEVATION_LOCATIONS;
    if ( startType === UNDERGROUND || startType === FLOATING ) currEnd = { x: start2d.x, y: sceneFloor };

    // For each segment move, either circle around the current polygon or move in straight line toward end.
    const MAX_ITER = 1e04;
    let iter = 0;
    let currPoly = null;
    let currPolyIndex = -1;
    const waypoints = [];
    while ( iter < MAX_ITER ) {
      iter += 1;
      waypoints.push(currPosition);

      // 1. Is end moving us backwards? Move to scene floor or end2d.
      // This can happen if the polygon is "floating" above the scene floor.
      if ( currEnd.x < currPosition.x ) {
        currEnd = new PIXI.Point(currPosition.x,  sceneFloor);
        currPoly = null;
      }

      // 2. Are we at the end?
      if ( currPosition.almostEqual(currEnd) ) {
        currEnd = end2d;
        currPoly = null;
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
        currPolyIndex = currPoly._pts.findIndex(pt => pt.almostEqual(currEnd));
        continue;
      }

      // 4. Cycle to the next point along the polygon edge.
      currPolyIndex += 1;
      if ( currPolyIndex >= currPoly._pts.length ) currPolyIndex = 0;
      currPosition = currEnd;
      currEnd = currPoly._pts[currPolyIndex];
    }
    if ( iter >= MAX_ITER ) console.error("constructRegionsPath|Iteration exceeded max iterations!", start ?? start2d, end ?? end2d);
    return waypoints;
  }



  /**
   * Construct a 2d cutaway of the regions along a given line.
   * X-axis is the distance from the start point.
   * Y-axis is elevation. Note y increases as moving up, which is opposite of Foundry.
   * Only handles plateaus and ramps; ignores stairs.
   * @param {RegionMovementWaypoint} start          Start of the path; cutaway will be extended 2 pixels before.
   * @param {RegionMovementWaypoint} end            End of the path; cutaway will be extended 2 pixels after
   * @param {Region[]} regions                      Regions to test
   * @returns {PIXI.Polygon[]} Array of polygons representing the cutaway.
   */
  _regions2dCutaway(start, end, regions) {
    const paths = [];
    for ( const region of regions ) {
      const combined = region[MODULE_ID]._region2dCutaway(start, end);
      if ( combined ) paths.push(combined);
    }

    // Add the scene floor.
    // Build the polygon slightly larger than start and end so that the start and end will
    // be correctly characterized (float/ground/underground).
    const MIN_ELEV = -1e06;
    const sceneFloor = this.sceneFloor;
    const dist = PIXI.Point.distanceBetween(start, end);
    const floorPoly = new PIXI.Polygon(-2, sceneFloor, -2, MIN_ELEV, dist + 2, MIN_ELEV, dist + 2, sceneFloor);
    paths.push(ClipperPaths.fromPolygons([floorPoly]));

    // if ( !paths.length ) return [];

    // Union the paths.
    const combinedPaths = ClipperPaths.combinePaths(paths);
    const combinedPolys = combinedPaths.clean().toPolygons();

    // If all holes or no polygons, we are done.
    // TODO: This can never happen if the floor is added first.
    if ( !combinedPolys.length || combinedPolys.every(poly => !poly.isPositive) ) return [];

    // TODO: Add tiles as very thin polygons?

    // At this point, there should not be any holes.
    // Holes go top-to-bottom, so any hole cuts the polygon in two from a cutaway perspective.
    if ( combinedPolys.some(poly => !poly.isPositive) ) console.error("Combined cutaway polygons still have holes.");
    // combinedPolys.forEach(poly => Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5 }))
    return combinedPolys;
  }

  /**
   * Convert to a cutaway coordinate.
   * @param {RegionMovementWaypoint} waypoint   Point to convert
   * @param {RegionMovementWaypoint} start      Starting coordinates for the line segment
   * @returns {PIXI.Point} Point where x is the distance from start and y is the elevation
   */
  _to2dCutawayCoordinate(waypoint, start) {
    return new PIXI.Point(PIXI.Point.distanceBetween(start, waypoint), waypoint.elevation);
  }

  /**
   * Convert from a cutaway coordinate.
   * @param {PIXI.Point} pt                     2d cutaway point to convert
   * @param {RegionMovementWaypoint} start      Starting coordinates for the line segment
   * @param {RegionMovementWaypoint} end        Ending coordinates for the line segment
   * @returns {PIXI.Point} Point in canvas coordinates, with elevation property
   */
  _from2dCutawayCoordinate(pt, start, end) {
    start = PIXI.Point._tmp.copyFrom(start);
    end = PIXI.Point._tmp2.copyFrom(end);
    const canvasPt = start.towardsPoint(end, pt.x);
    canvasPt.elevation = pt.y;
    return canvasPt;
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
   * @returns {PIXI.Point[]} The found path
   */
  _convexPath(start2d, end2d, polys, inverted = false, iter = 0) {
    const ixs = polygonsIntersections(start2d, end2d, polys);
    if ( !ixs.length ) return [start2d, end2d];

    // Replace the polygon with a convex hull version.
    const ixPoly = ixs[0].poly;
    ixPoly._pts ??= [...ixPoly.iteratePoints({ close: false })];
    const hull = PIXI.Polygon.convexHull([start2d, ...ixPoly._pts, end2d]);

    // Walk the convex hull.
    // Orient the hull so that iterating the points or edges will move in the direction we want to go.
    let walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
    if ( inverted ) walkDir = walkDir === "ccw" ? "cw" : "ccw";
    if ( hull.isClockwise ^ (walkDir === "cw") ) hull.reverseOrientation();
    hull._pts = [...hull.iteratePoints({ close: false })];
    let currPolyIndex = hull._pts.findIndex(pt => pt.almostEqual(start2d));
    if ( !~currPolyIndex ) {
      console.warn("convexPath|Start point not found in the convex polygon.");
      return [start2d, end2d];
    }
    polys = polys.filter(poly => poly !== ixPoly);

    let currPosition = start2d;
    currPolyIndex += 1;
    if ( currPolyIndex >= hull._pts.length ) currPolyIndex = 0;
    let nextPosition = hull._pts[currPolyIndex];
    const waypoints = [];
    const MAX_ITER = 1e04;
    while ( currPosition.x < end2d.x && iter < MAX_ITER ) {
      iter += 1;
      if ( polys.length ) {
        const ixs = polygonsIntersections(currPosition, nextPosition, polys, hull);
        if ( ixs.length ) {
          // Create a convex hull for this new polygon.
          const ixPoly = ixs[0].poly;
          ixPoly._pts ??= [...ixPoly.iteratePoints({ close: false })];
          const ixHull = PIXI.Polygon.convexHull([currPosition, ...ixPoly._pts, end2d]);
          if ( ixHull.isClockwise ^ (walkDir === "cw") ) ixHull.reverseOrientation();
          ixHull._pts = [...ixHull.iteratePoints({ close: false })];

          // Combine and redo.
          polys = polys.filter(poly => poly !== ixPoly);
          const clipperPaths = ClipperPaths.fromPolygons([...polys, hull, ixHull]);
          const combinedPolys = ClipperPaths.combinePaths(clipperPaths).clean().toPolygons();
          return this._convexPath(start2d, end2d, combinedPolys, inverted, iter);
        }
      }
      waypoints.push(currPosition);
      currPosition = nextPosition;
      currPolyIndex += 1;
      if ( currPolyIndex >= hull._pts.length ) currPolyIndex = 0;
      nextPosition = hull._pts[currPolyIndex];
    }
    waypoints.push(end2d);
    if ( iter >= MAX_ITER ) console.error("convexPath|Iteration exceeded max iterations!", start2d, end2d);
    return waypoints;
  }


  // ----- NOTE: Private methods ----- //




  // ----- NOTE: Basic Helper methods ----- //




  // ----- NOTE: Debugging ----- //

  /**
   * Draw at 0,0.
   * Flip y so it faces up.
   * Change the elevation dimension to match.
   * Set min elevation to one grid unit below the scene.
   */
  drawCutawayPolygon(poly, opts = {}) {
    const Draw = CONFIG.GeometryLib.Draw;
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    opts.color ??= Draw.COLORS.red;
    opts.fill ??= Draw.COLORS.red;
    opts.fillAlpha ??= 0.3;
    const invertedPolyPoints = [];
    const floor = gridUnitsToPixels(Region[MODULE_ID].sceneFloor - canvas.dimensions.distance);
    for ( let i = 0, n = poly.points.length; i < n; i += 2 ) {
      const x = poly.points[i];
      const y = poly.points[i+1];
      invertedPolyPoints.push(x, -Math.max(floor, gridUnitsToPixels(y)));
    }
    const invertedPoly = new PIXI.Polygon(invertedPolyPoints);
    Draw.shape(invertedPoly, opts);
  }

  /**
   * Draw the path from constructRegionsPath using the cutaway coordinates.
   * For debugging against the cutaway polygon.
   */
  drawCutawayPath(path, opts = {}) {
    const Draw = CONFIG.GeometryLib.Draw;
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    opts.color ??= Draw.COLORS.blue;
    const start = path[0];
    for ( let i = 1, n = path.length; i < n; i += 1 ) {
      const a = path[i - 1];
      const b = path[i];
      const a2d = this._to2dCutawayCoordinate(a, start);
      const b2d = this._to2dCutawayCoordinate(b, start);
      // Invert the y value for display.
      a2d.y = -gridUnitsToPixels(a2d.y);
      b2d.y = -gridUnitsToPixels(b2d.y);
      Draw.segment({ A: a2d, B: b2d }, opts);
    }
  }


  drawRegionMovement(segments) {
    for ( const segment of segments ) this.#drawRegionSegment(segment);
  }

  #drawRegionSegment(segment) {
    const Draw = CONFIG.GeometryLib.Draw
    const color = segment.type === Region.MOVEMENT_SEGMENT_TYPES.ENTER
      ?  Draw.COLORS.green
        : segment.type === Region.MOVEMENT_SEGMENT_TYPES.MOVE ? Draw.COLORS.orange
          : Draw.COLORS.red;
    const A = segment.from;
    const B = segment.to;
    Draw.point(A, { color });
    Draw.point(B, { color });
    Draw.segment({ A, B }, { color })
  }

  /**
   * Draw cutaway of the region segments.
   */
  drawRegionMovementCutaway(segments) {
    const pathWaypoints = RegionElevationHandler.fromSegments(segments);
    this.drawRegionPathCutaway(pathWaypoints)
  }

  /**
   * For debugging.
   * Draw line segments on the 2d canvas connecting the 2d parts of the path.
   * @param {PathArray<RegionMoveWaypoint>} path
   */
  drawRegionPath(path, { color } = {}) {
    const Draw = CONFIG.GeometryLib.Draw
    color ??= Draw.COLORS.blue;
    for ( let i = 1; i < path.length; i += 1 ) {
      const A = path[i - 1];
      const B = path[i];
      Draw.point(A, { color });
      Draw.point(B, { color });
      Draw.segment({ A, B }, { color })
    }
  }

  /**
   * For debugging.
   * Draw line segments representing a cut-away of the path, where
   * 2d distance is along the x and elevation is y. Starts at path origin.
   * @param {PathArray<RegionMoveWaypoint>} path
   */
  drawRegionPathCutaway(path) {
    const color = CONFIG.GeometryLib.Draw.COLORS.red;
    const start = path[0];
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
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

    const mRot = CONFIG.GeometryLib.Matrix.rotationZ(angle, false);
    const delta = {...path[0]};
    cutaway.forEach(p => {
      const tmp = mRot.multiplyPoint2d(p).add(delta);
      p.copyFrom(tmp);
    });

    this.drawRegionPath(cutaway, { color });
    return cutaway;
  }
}



// ----- NOTE: Helper functions ----- //

/**
 * Does this segment intersect any of an array of polygons
 * @param {Point} a                 The starting endpoint of the segment
 * @param {Point} b                 The ending endpoint of the segment
 * @param {PIXI.Polygon[]} polys    The polygons to test; May have cached properties:
 *   - _xMinMax: minimum and maximum x values
 *   - _edges: Array of edges for the polygon
 * @param {PIXI.Polygon} skipPoly   Ignore this polygon
 * Note: If not already present, these properties will be cached.
 * @returns {boolean} True if any intersection occurs
 */
function lineSegmentIntersectsPolygons(a, b, combinedPolys, skipPoly) {
  return combinedPolys.some(poly => {
    if ( poly === skipPoly ) return;
    poly._pts ??= [...poly.iteratePoints({close: false})];
    poly._minMax ??= Math.minMax(...poly._pts.map(pt => pt.x));
    if ( poly._xMinMax && poly._xMinMax.max <= a.x ) return false;
    poly._edges ??= [...poly.iterateEdges({ close: true })];
    if ( !foundry.utils.lineSegmentIntersects(a, b, { edges: poly._edges }) ) return false;
    return poly.lineSegmentIntersects(a, b, { edges: poly._edges });
  });
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
    poly._pts ??= [...poly.iteratePoints({close: false})];
    poly._minMax ??= Math.minMax(...poly._pts.map(pt => pt.x));
    if ( poly._xMinMax && poly._xMinMax.max <= a.x ) return;
    poly._edges ??= [...poly.iterateEdges({ close: true })];
    if ( !poly.lineSegmentIntersects(a, b, { edges: poly._edges }) ) return;

    // Retrieve the indices so that the edge can be linked to the intersection, for traversing the poly.
    const ixIndices = poly.segmentIntersections(a, b, { edges: poly._edges, indices: true });
    ixIndices.forEach(i => {
      const edge = poly._edges[i];
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
function pointOnPolygonEdge(a, poly) {
  poly._edges ??= [...poly.iterateEdges({ close: true })];
  a = PIXI.Point._tmp.copyFrom(a);
  for ( const edge of poly._edges ) {
    const pt = foundry.utils.closestPointToSegment(a, edge.A, edge.B);
    if ( a.almostEqual(pt) ) return edge;
  }
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
  const locs = Region[MODULE_ID].constructor.ELEVATION_LOCATIONS;
  for ( const poly of polys ) {
    const edge = pointOnPolygonEdge(pt, poly);
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
  combinedBounds.pad(0, 2)

  const polyPaths = ClipperPaths.fromPolygons(polys);
  const boundsPath = ClipperPaths.fromPolygons([combinedBounds.toPolygon()]);
  const invertedPath = polyPaths.diffPaths(boundsPath);
  return invertedPath.toPolygons();
}

