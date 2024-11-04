/* globals
CONFIG,
foundry,
PIXI,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "../const.js";
import {
  isPlateau,
  isRamp,
  regionWaypointsXYEqual } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Plane } from "../geometry/3d/Plane.js";
import { RegionMovementWaypoint3d } from "../geometry/3d/RegionMovementWaypoint3d.js";
import { Matrix } from "../geometry/Matrix.js";
import { ElevationHandler } from "../ElevationHandler.js";

/**
 * Single region elevation handler
 * Class that handles the plateau/ramp within a region.
 * Encapsulated inside Region.prototype.terrainmapper class
 */
export class RegionElevationHandler {
  /** @type {Region} */
  region;

  constructor(region) {
    this.region = region;
  }

  // ----- NOTE: Getters ----- //

  /** @type {boolean} */
  get isElevated() { return this.isPlateau || this.isRamp; }

  /** @type {boolean} */
  get isPlateau() { return isPlateau(this.region); }

  /** @type {boolean} */
  get isRamp() { return isRamp(this.region); }

  /** @type {number} */
  get plateauElevation() { return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.PLATEAU_ELEVATION) || 0; }

  /** @type {number} */
  get rampFloor() { return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.RAMP.FLOOR) || 0; }

  /** @type {number} */
  get rampDirection() { return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.RAMP.DIRECTION) || 0; }

  /** @type {number} */
  get rampStepSize() { return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.RAMP.STEP_SIZE) || 0; }

  /** @type {boolean} */
  get splitPolygons() { return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.RAMP.SPLIT_POLYGONS); }

  /** @type {FLAGS.REGION.CHOICES} */
  get algorithm() {
    return this.region.document.getFlag(MODULE_ID, FLAGS.REGION.ELEVATION_ALGORITHM) || FLAGS.REGION.CHOICES.PLATEAU;
  }

  /** @type {PIXI.Polygon} */
  get nonHolePolygons() { return this.region.polygons.filter(poly => poly._isPositive); }

  /** @type {object} */
  #minMax;

  /** @type {object} */
  #minMaxPolys = new WeakMap();

  get minMax() { return this.#minMax || (this.#minMax = this.#minMaxRegionPointsAlongAxis()); }

  get minMaxPolys() {
    // Confirm polygons are still valid; if not, redo.
    // TODO: Is this strictly necessary or will cache invalidation be sufficient?
    if ( this.nonHolePolygons.some(poly => !this.#minMaxPolys.has(poly)) ) this.#minMaxRegionPointsAlongAxis();
    return this.#minMaxPolys;
  }

  /** @type {PIXI.Point[]} */
  #rampCutpoints = new WeakMap();

  /**
   * Cutpoints for the ramp.
   * @param {PIXI.Polygon} [poly]     If provided, will calculate cutpoints for a specific poly in the region
   * @returns {PIXI.Point[]}
   */
  getRampCutpoints(poly) {
    const usePoly = poly && this.splitPolygons;
    const key = usePoly ? poly : this;
    if ( this.#rampCutpoints.has(key) ) return this.#rampCutpoints.get(key);

    const minMax = usePoly ? this.minMaxPolys.get(poly) : this.minMax;
    const cutpoints = this.#rampIdealCutpoints(minMax);
    this.#rampCutpoints.set(key, cutpoints);
    return cutpoints;
  }

  clearCache() {
    this.#minMax = undefined;
    this.#rampCutpoints = new WeakMap();  // No clear for WeakMap.
    this.#minMaxPolys = new WeakMap(); // No clear for WeakMap.
  }

  // Terrain data
  /** @type {boolean} */
  get hasTerrain() { return [...this.region.document.behaviors].some(b => !b.disabled && b.type === `${MODULE_ID}.setTerrain`); }

  /** @type {Set<Terrain>} */
  get terrains() {
    const terrains = new Set();
    for ( const b of this.region.document.behaviors.values() ) {
      if ( b.disabled || b.type !== `${MODULE_ID}.setTerrain` ) continue;
      b.system.terrains.forEach(t => terrains.add(CONFIG[MODULE_ID].Terrain._instances.get(t)));
    }
    return terrains;
  }

  // ----- NOTE: Primary methods ----- //

  /**
   * Determine the elevation upon moving into this region.
   * The provided location is not tested for whether it is within the region.
   * @param {Point} location   Position immediately upon entry; Position required only for ramps
   * @returns {number} The elevation of the plateau or the ramp at this location
   */
  elevationUponEntry(location) {
    const { PLATEAU, RAMP, NONE } = FLAGS.REGION.CHOICES;
    switch ( this.algorithm ) {
      case NONE: return location.elevation;
      case PLATEAU: return this.plateauElevation;
      case RAMP: return this.#rampElevation(location);
    }
  }

  /**
   * Determine if a line segment intersects this region's plateau or ramp.
   * Note: Does not test if the returned point is within the region.
   * @param {RegionMovementWaypoint3d} a      Start position and grid elevation
   * @param {RegionMovementWaypoint3d} b      End position and grid elevation
   * @returns {RegionMovementWaypoint3d|null} The intersection.
   */
  plateauSegmentIntersection(a, b) {
    if ( !(a instanceof RegionMovementWaypoint3d) ) a = RegionMovementWaypoint3d.fromObject(a);
    if ( !(b instanceof RegionMovementWaypoint3d) ) b = RegionMovementWaypoint3d.fromObject(b);

    if ( a.equalXY(b) ) {
      // A|b is a vertical line in the z direction.
      const e = Math.max(ElevationHandler.nearestGroundElevation(a), ElevationHandler.nearestGroundElevation(b));
      if ( e.between(a.elevation, b.elevation) ) return RegionMovementWaypoint3d.fromLocationWithElevation(a, e);
      return null;
    }

    // First intersect the plane, which may be at an angle for a ramp.
    let minMax;
    if ( this.splitPolygons && this.isRamp ) {
      const poly = this.nonHolePolygons.find(poly => poly.lineSegmentIntersects(a, b, { inside: true }));
      minMax = this.minMaxPolys(poly);
    }
    minMax ??= this.minMax;

    const p = this._plateauPlane(minMax);
    if ( !p.lineSegmentIntersects(a, b) ) return null;
    const ix = RegionMovementWaypoint3d.fromObject(p.lineSegmentIntersection(a, b));

    // Then get the actual location for the step size.
    ix.elevation = this.elevationUponEntry(ix);
    return ix;
  }


  // ----- NOTE: Secondary methods ----- //

  /**
   * Calculate the plane of the plateau or ramp.
   * @param {object} minMax
   * @returns {Plane} If not a ramp, will return the horizontal plane
   */
  _plateauPlane(minMax) {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const { plateauElevation, rampFloor } = this;
    if ( this.isPlateau ) return new Plane(new Point3d(0, 0, gridUnitsToPixels(plateauElevation)));

    // Construct a plane using three points: min/max and a third orthogonal point.
    minMax ??= this.minMax;
    const min = new Point3d(minMax.min.x, minMax.min.y, gridUnitsToPixels(rampFloor));
    const max = new Point3d(minMax.max.x, minMax.max.y, gridUnitsToPixels(plateauElevation));

    // Find an orthogonal point.
    // Because ramps are not skewed to the canvas, can use the 2d normal.
    const dir = max.subtract(min);
    const cDir = new Point3d(dir.y, -dir.x); // https://gamedev.stackexchange.com/questions/70075/how-can-i-find-the-perpendicular-to-a-2d-vector
    const c = min.add(cDir);

    // Get a point at the same elevation as min in the given direction.
    return Plane.fromPoints(min, max, c);
  }

  /**
   * Construct the cutaway shapes for a segment that traverses this region.
   * @param {RegionMovementWaypoint3d} start          Start of the segment
   * @param {RegionMovementWaypoint3d} end            End of the segment
   * @param {object} [opts]                           Options that affect the polygon shape
   * @param {boolean} [opts.usePlateauElevation=true] Use the plateau or ramp shape instead of the region top elevation
   * @returns {CutawayPolygon[]} The cutaway polygons for the region, or empty array if all polys are holes.
   */
  _cutaway(start, end, { usePlateauElevation = true } = {}) {
    const result = [];
    let allHoles = true;
    const opts = this.#cutawayOptionFunctions(usePlateauElevation);
    const addSteps = this.isRamp && this.rampStepSize;
    const stepFn = addSteps ? (a, b) => {
      const cutpoints = this._rampCutpointsForSegment(a, b);
      if ( !cutpoints.length ) return [];

      // Ensure the steps are going in the right direction.
      const rampDir = a.z > b.z;
      const stepDir = cutpoints[0].z > cutpoints.at(-1);
      if ( rampDir ^ stepDir ) cutpoints.reverse();
      return [a, ...cutpoints, b];
    } : undefined;
    for ( const regionPoly of this.region.polygons ) {
      allHoles &&= !regionPoly.isPositive;
      const cutaways = regionPoly.cutaway(start, end, opts);
      if ( addSteps && regionPoly.isPositive ) cutaways.forEach(cutawayPoly => cutawayPoly.insertTopSteps(stepFn));
      result.push(...cutaways);
    }
    if ( allHoles ) return [];
    return result;
  }

  /**
   * Calculate the cutaway intersections for a segment that traverses this region.
   * @param {RegionMovementWaypoint3d} start          Start of the segment
   * @param {RegionMovementWaypoint3d} end            End of the segment
   * @param {object} [opts]                           Options that affect the polygon shape
   * @param {boolean} [opts.usePlateauElevation=true] Use the plateau or ramp shape instead of the region top elevation
   * @returns {PIXI.Point[]}
   */
  _cutawayIntersections(start, end, { usePlateauElevation = true } = {}) {
    const cutaways = this._cutaway(start, end, { usePlateauElevation });
    return cutaways.flatMap(cutaway => cutaway.intersectSegment3d(start, end));
  }

  /**
   * Used by _cutaway and _cutawayIntersections
   * @param {string} method
   * @returns {object} { result, allHoles }
   */
  #applyCutawayMethod(method, start, end, usePlateauElevation = true) {
    const result = [];
    let allHoles = true;
    const nonHolePolygons = (this.isRamp && this.splitPolygons) ? this.nonHolePolygons : [];
    for ( const regionPoly of this.region.polygons ) {
      // If this poly is a hole, need the positive polygon for forming the step coordinates.
      let poly = regionPoly;
      if ( !regionPoly.isPositive ) {
        poly = nonHolePolygons.find(p => p.overlaps(regionPoly));
      }
      const opts = this.#cutawayOptionFunctions(poly, start, end, usePlateauElevation);
      const ixs = regionPoly[method](start, end, opts);
      result.push(...ixs);
      allHoles &&= !regionPoly.isPositive;
    }
    return { result, allHoles };
  }

  /**
   * Adjust region movement segments for plateau regions
   * A plateau forces segments that cross into the region to be at elevation, along with
   * all segment points within the region. Starting within does not count.
   * @param {RegionMovementSegment[]} segments
   * @param {RegionBehavior} behavior
   */
  _modifySegments(segments) {
    if ( !this.isElevated ) return segments;

    const { ENTER, MOVE, EXIT } = Region.MOVEMENT_SEGMENT_TYPES;
    const terrainFloor = ElevationHandler.sceneFloor;
    let entered = false;
    for ( let i = 0, n = segments.length; i < n; i += 1 ) {
      const segment = segments[i];
      if ( !segment ) { console.warn("segment not defined!"); continue; }
      switch ( segment.type ) {
        case ENTER: {
          entered = true;

          // If already at elevation, we are finished.
          const elevation = this.elevationUponEntry(segment.to);
          if ( elevation === segment.to.elevation ) break;

          // Add a vertical move up after the enter.
          const vSegment = constructVerticalMoveSegment(segment.to, elevation);
          segments.splice(i + 1, 0, vSegment);
          i += 1;
          n += 1;
          break;
        }
        case MOVE: {
          const elevation = this.elevationUponEntry(segment.from);
          if ( !entered ) {
            if ( segment.from.elevation === elevation ) entered = true; // At plateau.
            else if ( segment.from.elevation > elevation && segment.to.elevation < elevation ) { // Crosses plateau.
              // Split into two segments.
              const ix = regionWaypointsXYEqual(segment.from, segment.to)
                ? { ...segment.from, elevation }
                : this.plateauSegmentIntersection(segment.from, segment.to);
              entered = true;
              const fromIx = { type: MOVE, from: ix, to: segment.to };
              segment.to = ix;
              segments.splice(i + 1, 0, fromIx);
              n += 1;
            }
          }

          // If we entered, subsequent move should be set to the elevation.
          const toElevation = this.elevationUponEntry(segment.to);
          if ( entered ) {
            segment.from.elevation = Math.max(toElevation, segment.from.elevation);
            segment.to.elevation = Math.max(toElevation, segment.to.elevation);
          } else if ( segment.to.elevation === toElevation ) entered = true; // Do after entered test so from is not changed.
          break;
        }
        case EXIT: {
          entered = false;

          // Add vertical move (down) to terrain elevation if not already there.
          const numAdded = insertVerticalMoveToTerrainFloor(i, segments, terrainFloor);
          i += numAdded;
          n += numAdded;

          // Primarily used if there are holes in the region.
          // Ensure the next entry is at the current elevation.
          const nextSegment = segments[i + 1];
          if ( nextSegment ) nextSegment.from.elevation = terrainFloor;
          break;
        }
      }
    }
    return segments;
  }

  /**
   * Determine the cutpoints of the ramp for a given straight line within the ramp.
   * Assumes but does not test that start and end are actually within the ramp region.
   * @param {PIXI.Point} a              Start of the segment
   * @param {PIXI.Point} b              End of the segment
   * @param {PIXI.Polygon} [poly]       For split polygons, the poly to use
   * @returns {PIXI.RegionMovementWaypoint3d[]} Array of points from start to end at which elevation changes.
   */
  _rampCutpointsForSegment(a, b, poly) {
    const RegionMovementWaypoint3d = CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d;

    // For each ideal cutpoint on the ramp, intersect the line orthogonal to the ideal cutpoint line
    // at the ideal cutpoint.
    const minMax = this.minMax;
    const dir = minMax.max.subtract(minMax.min);
    const orthoDir = new PIXI.Point(dir.y, -dir.x); // 2d Orthogonal of {x, y} is {y, -x}
    const cutpoints = [];

    // Create steps where position is same but elevation changes.
    // Start at the elevation for a—before the first cutpoint.
    const idealCutpoints = this.getRampCutpoints(poly);
    let startingElevation = this.rampFloor;
    for ( let i = 0, n = idealCutpoints.length; i < n; i += 1 ) {
      const idealCutpoint = idealCutpoints[i];
      const orthoPt = idealCutpoint.add(orthoDir);
      const ix = foundry.utils.lineLineIntersection(a, b, idealCutpoint, orthoPt);
      if ( !ix ) break; // If one does not intersect, none will intersect.
      if ( ix.t0 < 0 || ix.t0 > 1 ) {
        startingElevation = idealCutpoint.elevation;
        continue;
      }
      const cutpoint0 = RegionMovementWaypoint3d.fromLocationWithElevation(ix, startingElevation);
      const cutpoint1 = RegionMovementWaypoint3d.fromLocationWithElevation(ix, idealCutpoint.elevation);
      cutpoint0.t0 = ix.t0;
      cutpoint1.t0 = ix.t0;
      cutpoints.push(cutpoint0, cutpoint1);
      startingElevation = idealCutpoint.elevation;
    }

    return cutpoints;
  }

  // ----- NOTE: Static methods ----- //

  // ----- NOTE: Private methods ----- //

  /**
   * Determine the minimum/maximum points of the region along a given axis.
   * @param {Region} region             The region to measure
   * @param {number} [direction=0]      The axis direction, in degrees. 0º is S, 90º is W
   * @returns {object}
   * - @prop {Point} min    Where region first intersects the line orthogonal to direction, moving in direction
   * - @prop {Point} max    Where region last intersects the line orthogonal to direction, moving in direction
   */
  #minMaxRegionPointsAlongAxis() {
    const { region, rampDirection } = this;

    // By definition, holes cannot be the minimum/maximum points.
    const polys = this.nonHolePolygons;
    const nPolys = polys.length;
    if ( !nPolys ) return undefined;

    // Set the individual min/max per polygon.
    this.#minMaxPolys = new WeakMap();
    for ( const poly of polys ) this.#minMaxPolys.set(poly, minMaxPolygonPointsAlongAxis(poly, rampDirection));

    // Determine the min/max for the bounds.
    // For consistency (and speed), rotate the bounds of the region.
    const center = region.bounds.center;
    const minMax = minMaxPolygonPointsAlongAxis(polys[0], rampDirection, center);
    minMax.min._dist2 = PIXI.Point.distanceSquaredBetween(minMax.min, center);
    minMax.max._dist2 = PIXI.Point.distanceSquaredBetween(minMax.max, center);
    for ( let i = 1; i < nPolys; i += 1 ) {
      const res = minMaxPolygonPointsAlongAxis(polys[i], rampDirection, center);

      // Find the point that is further from the centroid.
      res.min._dist2 = PIXI.Point.distanceSquaredBetween(res.min, center);
      res.max._dist2 = PIXI.Point.distanceSquaredBetween(res.max, center);
      if ( res.min._dist2 > minMax.min._dist2 ) minMax.min = res.min;
      if ( res.max._dist2 > minMax.max._dist2 ) minMax.max = res.max;
    }
    return minMax;
  }

  /**
   * Determine the elevation of the ramp at a given location.
   * Does not confirm the waypoint is within the region.
   * @param {RegionMovementWaypoint3d} location      2d location
   * @returns {number} The elevation of the ramp at this location.
   */
  #rampElevation(waypoint) {
    /* Example
    10 --> 25
    stepsize 5:
    10 --> 15 --> 20 --> 25
    equal division: (25 - 10) / 5 = 3. 3 splits, so 1/4, 2/4, 3/4

    stepsize 3:
    10 --> 13 --> 16 --> 19 --> 22 --> 25
    (25 - 10) / 3 = 5. 1/6,...

    stepsize 4:
    10 --> 14 --> 18 --> 22 --> 25
    (25 - 10) / 4 = 3.75 --> 4 splits. So 1/5, 2/5, 3/5, 4/5

    stepsize 6:
    10 --> 16 --> 22 --> 25
    15 / 6 = 2.5. 3 splits.

    stepsize 7:
    10 --> 17 --> 24 --> 25
    15 / 7 = ~2.14. 3 splits.
    */
    let minMax = this.minMax;
    let poly;
    if ( this.splitPolygons ) {
      poly = this.nonHolePolygons.find(poly => poly.contains(waypoint.x, waypoint.y));
      minMax = this.minMaxPolys.get(poly);
    }
    if ( !minMax ) return waypoint.elevation;
    const closestPt = foundry.utils.closestPointToSegment(waypoint, minMax.min, minMax.max);
    const t0 = Math.clamp(PIXI.Point.distanceBetween(minMax.min, closestPt)
      / PIXI.Point.distanceBetween(minMax.min, minMax.max), 0, 1);

    // Floor (min) --> pt --> elevation (max)
    // If no stepsize, elevation is simply proportional
    // Formula will break if t0 = 1. It will go to the next step. E.g., 28 instead of 25
    const { rampFloor, plateauElevation } = this;
    if ( t0.almostEqual(0) ) return rampFloor;
    if ( t0.almostEqual(1) ) return plateauElevation;
    if ( this.rampStepSize ) {
      const cutPoints = this.getRampCutpoints(poly);
      const nearestPt = cutPoints.findLast(pt => pt.t.almostEqual(t0) || pt.t < t0);
      if ( !nearestPt ) return rampFloor;
      return nearestPt.elevation;
    }

    // Ramp is basic incline; no steps.
    const delta = plateauElevation - rampFloor;
    return Math.round(rampFloor + (t0 * delta));
  }

  /**
   * Cutpoints for ramp steps, along the directional line for the ramp.
   * Smallest t follows the ramp floor; largest t is the switch to the plateauElevation.
   * @param {object} minMax         Uses the provided minMax to calculate the cutpoints.
   * @returns {PIXI.Point[]} Array of points on the ramp direction line. Additional properties:
   *   - @prop {number} elevation   New elevation when ≥ t
   *   - @prop {number} t           Percent distance from minPt
   */
  #rampIdealCutpoints(minMax) {
    const { rampFloor, plateauElevation, rampStepSize } = this;
    if ( !rampStepSize ) return [];
    const delta = plateauElevation - rampFloor;
    const numSplits = Math.ceil(delta / rampStepSize);
    const minPt = PIXI.Point.fromObject(minMax.min);
    const maxPt = PIXI.Point.fromObject(minMax.max);
    const splits = Array.fromRange(numSplits).map(i => (i + 1) / (numSplits + 1));
    return splits.map((t, idx) => {
      const pt = minPt.projectToward(maxPt, t);
      pt.t = t;
      pt.elevation = rampFloor + ((idx + 1) * rampStepSize);
      return pt;
    });
  }

  /**
   * Construct cutaway functions for this region.
   * @returns {object}
   *   - @prop {function} topElevationFn
   *   - @prop {function} bottomElevationFn
   *   - @prop {function} cutPointsFn
   */
  #cutawayOptionFunctions(usePlateauElevation = true) {
    const { gridUnitsToPixels, pixelsToGridUnits } = CONFIG.GeometryLib.utils;
    const MIN_ELEV = -1e06;
    const MAX_ELEV = 1e06;
    const topE = gridUnitsToPixels(this.region.document.elevation.top ?? MAX_ELEV);
    const bottomE = gridUnitsToPixels(this.region.document.elevation.bottom ?? MIN_ELEV); // Note: in grid units to avoid recalculation later.
    const topElevationFn = usePlateauElevation
      ? pt => gridUnitsToPixels(this.elevationUponEntry({ ...pt, elevation: pixelsToGridUnits(pt.z) }))
      : _pt => topE;
    const bottomElevationFn = _pt => bottomE;
    return { topElevationFn, bottomElevationFn };
  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Construct a vertical move segment.
 * @param {RegionWaypoint} waypoint
 * @param {number} targetElevation
 * @returns {RegionMoveSegment}
 */
function constructVerticalMoveSegment(waypoint, targetElevation) {
  return {
    from: {
      x: waypoint.x,
      y: waypoint.y,
      elevation: waypoint.elevation
    },
    to: {
      x: waypoint.x,
      y: waypoint.y,
      elevation: targetElevation
    },
    type: CONFIG.Region.objectClass.MOVEMENT_SEGMENT_TYPES.MOVE
  };
}

/**
 * Insert a vertical move down to the terrain floor
 * @param {number} i                            The index of the current segment
 * @param {RegionMovementSegment[]} segments    Segments for this path
 * @param {number} floor                        Elevation we are moving to
 */
function insertVerticalMoveToTerrainFloor(i, segments, floor) {
  const segment = segments[i];
  segment.from.elevation = floor;
  segment.to.elevation = floor;

  // If the previous segment is not at reset elevation, add vertical move (down)
  const prevSegment = segments[i - 1] ?? { to: segment.from }; // Use this segment's from if no previous segment.
  if ( prevSegment && prevSegment.to.elevation !== floor ) {
    const vSegment = constructVerticalMoveSegment(prevSegment.to, floor);
    segments.splice(i, 0, vSegment);
    return 1;
  }
  return 0;
}

/**
 * Locate the minimum/maximum points of a polygon along a given axis.
 * E.g., if the axis is from high to low y (due north), the points would be min: maxY, max: minY.
 * @param {PIXI.Polygon} poly         The polygon
 * @param {number} [direction=0]      The axis direction, in degrees. 0º is S, 90º is W
 * @param {number} [centroid]         Center of the polygon
 * @returns {object}
 * - @prop {PIXI.Point} min    Where polygon first intersects the line orthogonal to direction, moving in direction
 * - @prop {PIXI.Point} max    Where polygon last intersects the line orthogonal to direction, moving in direction
 */
function minMaxPolygonPointsAlongAxis(poly, direction = 0, centroid) { // eslint-disable-line default-param-last
  centroid ??= poly.center;
  if ( direction % 90 ) {
    // Rotate the polygon to direction 0 (due south).
    const rotatedPoly = rotatePolygon(poly, Math.toRadians(360 - direction), centroid);
    const bounds = rotatedPoly.getBounds();

    // Rotate back
    const minMaxRotatedPoly = new PIXI.Polygon(centroid.x, bounds.top, centroid.x, bounds.bottom);
    const minMaxPoly = rotatePolygon(minMaxRotatedPoly, -Math.toRadians(360 - direction), centroid);
    return {
      min: new PIXI.Point(minMaxPoly.points[0], minMaxPoly.points[1]),
      max: new PIXI.Point(minMaxPoly.points[2], minMaxPoly.points[3])
    };
  }

  // Tackle the simple cases.
  const bounds = poly.getBounds();
  switch ( direction ) {
    case 0: return { min: new PIXI.Point(centroid.x, bounds.top), max: new PIXI.Point(centroid.x, bounds.bottom) }; // Due south
    case 90: return { min: new PIXI.Point(bounds.right, centroid.y), max: new PIXI.Point(bounds.left, centroid.y) }; // Due west
    case 180: return { min: new PIXI.Point(centroid.x, bounds.bottom), max: new PIXI.Point(centroid.x, bounds.top) }; // Due north
    case 270: return { min: new PIXI.Point(bounds.left, centroid.y), max: new PIXI.Point(bounds.right, centroid.y) }; // Due east
  }
}

/**
 * Rotate a polygon a given amount clockwise, in radians.
 * @param {PIXI.Polygon} poly   The polygon
 * @param {number} rotation     The amount to rotate clockwise in radians
 * @param {number} [centroid]   Center of the polygon
 */
function rotatePolygon(poly, rotation = 0, centroid) { // eslint-disable-line default-param-last
  if ( !rotation ) return poly;
  centroid ??= poly.center;

  // Translate to 0,0, rotate, translate back based on centroid.
  const rot = Matrix.rotationZ(rotation, false);
  const trans = Matrix.translation(-centroid.x, -centroid.y);
  const revTrans = Matrix.translation(centroid.x, centroid.y);
  const M = trans.multiply3x3(rot).multiply3x3(revTrans);

  // Multiply by the points of the polygon.
  const nPoints = poly.points.length * 0.5;
  const arr = new Array(nPoints);
  for ( let i = 0; i < nPoints; i += 1 ) {
    const j = i * 2;
    arr[i] = [poly.points[j], poly.points[j+1], 1];
  }
  const polyM = new Matrix(arr);
  const rotatedM = polyM.multiply(M);

  const rotatedPoints = new Array(poly.points.length);
  for ( let i = 0; i < nPoints; i += 1 ) {
    const j = i * 2;
    rotatedPoints[j] = rotatedM.arr[i][0];
    rotatedPoints[j+1] = rotatedM.arr[i][1];
  }
  return new PIXI.Polygon(rotatedPoints);
}
