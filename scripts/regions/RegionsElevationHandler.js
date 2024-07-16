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
    INSIDE: 0,
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
  constructRegionsPath(start, end, { regions, flying = false, burrowing = false, samples } = {}) {
    if ( regionWaypointsEqual(start, end) ) return [start, end];
    regions = elevatedRegions(regions);
    if ( !regions.length ) return [start, end];
    const terrainFloor = this.sceneFloor;
    samples ??= [{x: 0, y: 0}];

    // Simple case: Elevation-only change.
    if ( regionWaypointsXYEqual(start, end) ) {
      if ( flying ) return [start, end];
      const groundE = this.nearestGroundElevation(end, { regions, burrowing, samples });
      return [start, { ...end, elevation: groundE }];
    }

    // If flying and burrowing, essentially a straight shot would work (ignoring, ftm, stairs).
    if ( flying && burrowing ) return [start, end];

    // If not flying or burrowing, the end point should be on the ground.
    // Start is handled below, in the loop.
    else if ( !flying && !burrowing ) {
      const endE = this.nearestGroundElevation(end);
      end = { ...end, elevation: endE };
    }

    // If not flying but burrowing, needs to be handled below.
    // Can only burrow within regions, so could still fall to ground.
    else if ( !flying && burrowing ) {
      const endE = this.nearestGroundElevation(start, { burrowing: true });
      end = { ...end, elevation: endE };
    }

    // If not burrowing but flying, handled below.

    // Locate all polygons within each region that are intersected.
    // Construct a polygon representing the cutaway.
    const combinedPolys = this._regions2dCutaway(start, end, regions);
    if ( !combinedPolys.length ) return [start, end];

    // Convert start and end to 2d-cutaway coordinates.
    const start2d = this._to2dCutawayCoordinate(start, start);
    const end2d = this._to2dCutawayCoordinate(end, start);

    // Orient the polygons so that iterating the points or edges will move in the direction we want to go.
    const walkDir = end2d.x > start2d.x ? "ccw" : "cw"; // Reversed b/c y-axis is flipped for purposes of Foundry.
    combinedPolys.forEach(poly => {
      if ( poly.isClockwise ^ (walkDir === "cw") ) poly.reverseOrientation();
    });

    // Walk the path, locating the closest intersection to the combined polygons.
    const MAX_ITER = 1e04;
    const destPoly = combinedPolys.find(poly => poly.contains(end2d.x, end2d.y));
    const waypoints = [];
    let atDestination = false;
    let currPosition = start2d;
    let currEnd = end2d;
    let currPoly = null;
    let iterA = 0;
    while ( !atDestination && iterA < MAX_ITER ) {
      iterA += 1;
      waypoints.push(currPosition);

      // If the current position is not on the ground and we have not adjusted the end location,
      // then move to ground if not flying.
      if ( !flying && currEnd.equals(end2d) ) {
        const groundE = this.nearestGroundElevation(currPosition, { regions, burrowing, samples });
        if ( groundE !== currPosition.elevation ) currEnd = new PIXI.Point(currPosition.x, groundE);
      }

      // Move to the next polygon intersection in the direction of currEnd.
      const ixs = polygonsIntersections(currPosition, currEnd, combinedPolys, currPoly);
      if ( !ixs.length ) {
        currPosition = currEnd;
        currEnd = end2d; // Reset the end from stairs or vertical move to terrain floor.
        continue;
      }
      const ix = ixs[0];
      let poly = ix.poly;

      // If the endpoint is inside this polygon, we are done.
      // (Only if burrowing to the endpoint is permitted, which would define the destPoly.)
      if ( poly === destPoly ) {
        waypoints.push(ix);
        waypoints.push(end2d);
        atDestination = true;
        break;
      }

      // If burrowing, just move straight through. Get the other intersection for this polygon.
      if ( burrowing ) {
        const otherIx = ixs.find(thisIx => this.ix !== thisIx && thisIx.poly === poly);
        if ( otherIx ) {
          waypoints.push(ix);
          currPosition = otherIx;
          break;
        }
      }

      /* Walk around the polygon until one of the following occurs:
      1. Move would take us toward start in the x direction.
      2. Move would take us under the terrain floor.
      3. Flying is permitted and we would move down.
      4. Flying is permitted and the end point is above the polygon and we have a straight shot.
      5. Stair is encountered.
      */
      currEnd = end2d; // Reset the end from stairs or vertical move to terrain floor.
      currPosition = PIXI.Point.fromObject(ix);
      let nextPt = ix.edge.B;
      let iterB = 0;
      let currIndex = poly._pts.findIndex(pt => pt.almostEqual(nextPt));
      while ( nextPt && iterB < MAX_ITER ) {
        iterB += 1;

        // TODO: Tiles intersections.

        if ( nextPt.x < currPosition.x ) break; // 1. Would move backward.
        const willHitFloor = nextPt.y < currPosition.y && nextPt.y <= terrainFloor // 2. Would move under terrain floor
        if (  willHitFloor && nextPt.y !== terrainFloor ) {
          nextPt = foundry.utils.lineLineIntersection(currPosition, nextPt,
            { x: start2d.x, y: terrainFloor }, { x: end2d.x, y: terrainFloor });
        }

        if ( flying && lineSegmentIntersectsPolygons(currPosition, end2d, combinedPolys, poly) ) {
          waypoints.push(currPosition);
          waypoints.push(end2d);
          atDestination = true;
          break;
        }

        waypoints.push(currPosition);
        currPosition = nextPt;

        if ( willHitFloor ) break;

        // Look ahead to the next point along the polygon edge.
        currIndex += 1;
        if ( currIndex >= poly._pts.length ) currIndex = 0;
        nextPt = poly._pts[currIndex];
      }
      if ( iterB >= MAX_ITER ) console.error("constructRegionsPath2|Iteration B exceeded max iterations!", start, end);
    }

    if ( iterA >= MAX_ITER ) console.error("constructRegionsPath2|Iteration A exceeded max iterations!", start, end);

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

    const locs = this.constructor.ELEVATION_LOCATIONS
    if ( inside && offPlateau ) return locs.INSIDE;
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
        const segments = region.segmentize(waypoints, samples, { teleport });
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
   * Construct a 2d cutaway of the regions along a given line.
   * X-axis is the distance from the start point.
   * Y-axis is elevation. Note y increases as moving up, which is opposite of Foundry.
   * Only handles plateaus and ramps; ignores stairs.
   * @param {RegionMovementWaypoint} start          Start of the path
   * @param {RegionMovementWaypoint} end            End of the path
   * @param {Region[]} regions                      Regions to test
   * @returns {PIXI.Polygon[]} Array of polygons representing the cutaway.
   */
  _regions2dCutaway(start, end, regions) {
    const paths = [];
    for ( const region of regions ) {
      const combined = region[MODULE_ID]._region2dCutaway(start, end);
      if ( combined.length ) paths.push(combined);
    }
    if ( !paths.length ) return [];

    // Union the paths.
    const combinedPaths = ClipperPaths.combinePaths(paths);
    const combinedPolys = combinedPaths.clean().toPolygons();

    // If all holes or no polygons, we are done.
    if ( !combinedPolys.length || combinedPolys.every(poly => !poly.isPositive) ) return [];

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

  // ----- NOTE: Private methods ----- //




  // ----- NOTE: Basic Helper methods ----- //

  // ----- NOTE: Debugging ----- //

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
    if ( poly === skipPoly ) return false;
    poly._pts ??= [...poly.iteratePoints({close: false})];
    poly._minMax ??= Math.minMax(...poly._pts.map(pt => pt.x));
    if ( poly._xMinMax && poly._xMinMax.max <= a.x ) return false;
    poly._edges ??= [...poly.iterateEdges({ close: true })];
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
