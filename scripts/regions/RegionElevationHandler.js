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
  isPlateau,
  isRamp,
  regionWaypointsXYEqual } from "../util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Plane } from "../geometry/3d/Plane.js";
import { ElevatedPoint } from "../geometry/3d/ElevatedPoint.js";
import { Matrix } from "../geometry/Matrix.js";
import { ElevationHandler } from "../ElevationHandler.js";
import { instanceOrTypeOf, gridUnitsToPixels, pixelsToGridUnits } from "../geometry/util.js";
import { AABB3d } from "../geometry/AABB.js";
import { Polygons3d } from "../geometry/3d/Polygon3d.js";
import { almostGreaterThan, almostLessThan, almostBetween } from "../geometry/util.js";

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
  get nonHolePolygons() { return this.region.document.polygons.filter(poly => poly._isPositive); }

  get holePolygons() { return this.region.document.polygons.filter(poly => !poly._isPositive); }

  #terrainAABB = new WeakMap();

  /**
   * Returns the terrain aabb if elevated, and the full region aabb otherwise.
   */
  getTerrainAABBForShape(shape) {
    if ( this.#terrainAABB.has(shape) ) return this.#terrainAABB.get(shape);
    const maxZ = gridUnitsToPixels(this.isElevated ? this.plateauElevation : this.region.elevationE.top);
    const minZ = gridUnitsToPixels(this.region.elevationE.bottom);
    const method = `from${capitalizeFirstLetter(shape.type)}`;
    const pixiShape = this.getPixiShape(shape);
    const aabb = AABB3d[method](pixiShape, maxZ, minZ);
    this.#terrainAABB.set(shape, aabb);
    return aabb;
  }

  getTerrainAABBForRegion() {
    if ( this.#terrainAABB.has(this.region) ) return this.#terrainAABB.get(this.region);

    // Union all the shape AABBs, which is not so bad b/c they will be cached and likely reused.
    // Can skip holes, b/c they don't contribute to the bounds.
    const solidShapes = this.region.document.shapes.filter(shape => !shape.hole);
    const nShapes = solidShapes.length;
    const aabbs = new Array(nShapes);
    for ( let i = 0; i < nShapes; i += 1 ) aabbs[i] = this.getTerrainAABBForShape(solidShapes[i]);
    const aabb = AABB3d.union(...aabbs);
    this.#terrainAABB.set(this.region, aabb);
    return aabb;
  }



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

  #pixiShapes = new WeakMap();

  getPixiShape(shape) {
    if ( this.#pixiShapes.has(shape) ) return this.#pixiShapes.get(shape);
    const pixiShape = this.constructor.pixiShapeForRegionShape(shape);
    this.#pixiShapes.set(shape, pixiShape);
    return pixiShape;
  }

  clearCache() {
    this.#minMax = undefined;
    this.#rampCutpoints = new WeakMap();  // No clear for WeakMap.
    this.#minMaxPolys = new WeakMap();
    this.#pixiShapes = new WeakMap();
    this.#terrainAABB = new WeakMap();
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

  // ----- NOTE: Bounds testing ----- //

  /**
   * Does this segment intersect the bounding box of 1 or more region shapes?
   * @param {PIXI.Point|Point3d} a      Endpoint of segment
   * @param {PIXI.Point|Point3d} b      Other segment endpoint
   * @param {["x", "y", "z"]} [axes]      Axes to test
   * @returns {boolean} True if within the bounding box
   */
  segmentInBounds(a, b, axes) {
    const regionAABB = this.getTerrainAABBForRegion();
    if ( !regionAABB.overlapsSegment(a, b, axes) ) return false;
    for ( const shape of this.region.document.shapes ) {
      if ( shape.hole ) continue;
      const shapeAABB = this.getTerrainAABBForShape(shape);
      if ( shapeAABB.overlapsSegment(a, b, axes) ) return true;
    }
    return false;
  }

  /**
   * Does this point intersect the bounding box of 1 or more region shapes?
   * @param {PIXI.Point|Point3d} a        Point to test
   * @param {["x", "y", "z"]} [axes]      Axes to test
   * @returns {boolean} True if within the bounding box
   */
  pointInBounds(a, axes) {
    const regionAABB = this.getTerrainAABBForRegion();
    if ( !regionAABB.containsPoint(a, axes) ) return false;
    for ( const shape of this.region.document.shapes ) {
      if ( shape.hole ) continue;
      const shapeAABB = this.getTerrainAABBForShape(shape);
      if ( shapeAABB.containsPoint(a, axes) ) return true;
    }
    return false;
  }

  /**
   * Does this point lie within one or more of the 2d shapes for the terrain?
   * @param {PIXI.Point|Point3d} a        Point to test
   * @returns {boolean}
   */
  test2dPoint(a) {
    for ( const shape of this.region.document.shapes ) {
      if ( shape.hole ) continue;
      const pixiShape = this.getPixiShape(shape);
      if ( pixiShape.contains(a.x, a.y) ) return true;
    }
    return false;
  }

  /**
   * Terrain version of `region.document.testPoint`. Rejects if above or below the terrain.
   * @param {ElevatedPoint} a         Point to test
   * @returns {boolean}
   */
  testPoint(a) {
    if ( !this.pointInBounds(a, ["x", "y"] ) ) return false;
    if ( !this.isElevated ) return this.region.document.testPoint(a);
    if ( !this.test2dPoint(a) ) return false;
    const topE = this.elevationUponEntry(a);
    return almostLessThan(a.elevation, topE) && almostGreaterThan(a.elevation, this.region.elevationE.bottom);
  }


  /**
   * Where is this point relative to the terrain?
   * @param {ElevatedPoint} a        Point to test
   * @returns {ELEVATION_LOCATIONS}
   */
  pointLocation(pt) {
    const LOCS = this.constructor.ELEVATION_LOCATIONS;
    if ( !this.pointInBounds(pt, ["x", "y"]) ) return LOCS.OUTSIDE;
    if ( !this.test2dPoint(pt) ) return LOCS.OUTSIDE;

    // Definitely within the x/y of the region.
    const plateau = this.isElevated ? this.elevationUponEntry(pt) : this.region.topE;
    const locElev = pt.elevation;
    return locElev.almostEqual(plateau) ? LOCS.GROUND : locElev > plateau ? LOCS.ABOVE : LOCS.BELOW
  }

  /**
   * Does a 3d segment definitely intersect this region?
   * Does not test bounds.
   * @param {ElevatedPoint} a
   * @param {ElevatedPoint} b
   * @returns {boolean}
   */
  lineSegmentIntersects(a, b) {
    if ( this.testPoint(a) || this.testPoint(b) ) return true;

    // ---- Neither a or b are within the region.
    // If elevation change, test for plateau intersection.
    if ( a.z !== b.z ) {
      const ix = this.plateauSegmentIntersection(a, b);
      if ( ix && this.testPoint(ix) ) return true;
    }

    // If 2d change, the segment must cross the 2d border or a hole border.
    if ( !(a.x === b.x && a.y === b.y) ) {
      for ( const shape of this.region.document.shapes ) {
        const pixiShape = this.getPixiShape(shape);
        if (  pixiShape.lineSegmentIntersects(a, b, { inside: true }) ) return true;
      }
    }
    return false;
  }

  /**
   * Obtain the intersection points for a 3d segment against this region.
   * Does not test bounds.
   * @param {ElevatedPoint} a
   * @param {ElevatedPoint} b
   * @returns {ElevatedPoint[]}
   */
  segmentIntersections(a, b) {
    const ixs = [];
    const floor = this.region.elevationE.bottom;

    // Only test the top and bottom if the 3d line changes elevation.
    if ( a.z !== b.z ) {
      // Test top.
      const ix = this.plateauSegmentIntersection(a, b);
      if ( ix && this.testPoint(ix) ) ixs.push(ix);

      // Test bottom.
      if ( floor > -1e05 ) {
        const plane = new Plane(new Point3d(0, 0, gridUnitsToPixels(this.plateauElevation)));
        const ix = plane.lineSegmentIntersection(a, b);
        if ( ix && this.testPoint(ix) ) {
          const pt = ElevatedPoint.tmp.set(ix.x, ix.y, ix.z);
          pt.t0 = ix.t0;
          ixs.push(pt);
        }
      }
    }

    // Only test the sides if the 3d line changes x/y directions.
    if ( !(a.x === b.x && a.y === b.y) ) {

      // Test shapes, including holes. TODO: Better to test polygons here?
      for ( const shape of this.region.document.shapes ) {
        const shapeIxs = this.getPixiShape(shape).segmentIntersections(a, b);
        if ( !shapeIxs.length ) continue;

        // Use the t value to determine the elevation of the intersection.
        shapeIxs.forEach(ix => {
          const projPt = a.projectToward(b, ix.t0);

          // Intersection must fall within the region elevation at this XY location.
          const elev = this.elevationUponEntry(ix);
          if ( !almostBetween(projPt.elevation, floor, elev) ) return;
          projPt.t0 = ix.t0;
          ixs.push(projPt);
        });
      }
    }
    return ixs;
  }

  // ----- NOTE: Primary methods ----- //

  /**
   * Determine the elevation upon moving into this region.
   * The provided location is not tested for whether it is within the region.
   * @param {Point} a   Position immediately upon entry; Position required only for ramps
   * @returns {number} The elevation of the plateau or the ramp at this location
   */
  elevationUponEntry(pt) {
    const { PLATEAU, RAMP, NONE } = FLAGS.REGION.CHOICES;
    switch ( this.algorithm ) {
      case NONE: return a.elevation;
      case PLATEAU: return this.plateauElevation;
      case RAMP: return this._rampElevation(pt);
    }
  }

  /**
   * Determine if the current location is on the terrain floor.
   * Meaning it is within the elevated region and its elevation is approximately equal to that of the terrain at that point.
   * @param {ElevatedPoint} pt
   * @returns {boolean}
   */
  locationIsOnTerrain(pt) {
    const elev = this.elevationUponEntry(pt);
    return pt.elevation.almostEqual(elev);
  }

  /**
   * Determine if a line segment intersects this region's plateau or ramp.
   * Note: Does not test if the returned point is within the region.
   * @param {ElevatedPoint} a      Start position and grid elevation
   * @param {ElevatedPoint} b      End position and grid elevation
   * @returns {ElevatedPoint|null} The intersection.
   */
  plateauSegmentIntersection(a, b) {
    if ( !instanceOrTypeOf(a, ElevatedPoint) ) a = ElevatedPoint.fromObject(a);
    if ( !instanceOrTypeOf(b, ElevatedPoint) ) b = ElevatedPoint.fromObject(b);

    if ( a.equalXY(b) ) {
      // A|b is a vertical line in the z direction.
      const e = Math.max(ElevationHandler.nearestGroundElevation(a), ElevationHandler.nearestGroundElevation(b));
      if ( e.between(a.elevation, b.elevation) ) return ElevatedPoint.fromLocationWithElevation(a, e);
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
    const ix = p.lineSegmentIntersection(a, b);
    const out = ElevatedPoint.fromObject(ix);
    out.t0 = ix.t0;

    // Then get the actual location for the step size.
    ix.elevation = this.elevationUponEntry(ix);
    return ix;
  }

  /**
   * @typedef {object} Segment2d
   * Representation of a line segment
   * @prop {PIXI.Point} a
   * @prop {PIXI.Point} b
   */

  /**
   * For a given 2d line, return the points of intersection for the shapes in this region.
   * Accounts for holes.
   * @param {PIXI.Point} a      A point on the line
   * @param {PIXI.Point} b      A second point on the line, not equal to the first
   * @returns {Segment2d[]} Segments, where a and b contain t0 representing their relative positions a --> b
   */
  allIntersectingSegmentsForLineSegmentV2(a, b, firstOnly = false) {
    // Version using polygons
    const allIxs = [];
    for ( const polygon of this.region.document.polygons ) {
      const ixs = polygon.segmentIntersections(a, b, { tangents: false });
      if ( !ixs.length ) continue;

      ixs.forEach(ix => ix.isHole = !polygon.isPositive);
      allIxs.push(...ixs);
    }
    allIxs.sort((a, b) => a.t0 - b.t0);

    // Add start and and of the segment.
    // Avoid duplicates.
    // Don't add if the segment starts in a hole.
    if ( this.region.document.polygonTree.testPoint(a) && !allIxs[0].t0.almostEqual(0) ) allIxs.unshift({ x: a.x, y: a.y, t0: 0 });
    if ( this.region.document.polygonTree.testPoint(b) && !allIxs.at(-1).t0.almostEqual(1) ) allIxs.push({ x: b.x, y: b.y, t0: 1 });

    // allIxs.forEach(ix => Draw.point(ix));
    const allSegments = [];
    let currSegment = { a: null, b: null };
    for ( const ix of allIxs ) {
      if ( !currSegment.a ) currSegment.a = ix;
      else {
        currSegment.b = ix;
        allSegments.push(currSegment);
        if ( firstOnly ) break;
        currSegment = { a: null, b: null };
      }
    };
    // allSegments.forEach(s => Draw.segment(s));

    return allSegments;
  }

  /**
   * For a given 2d line, return the points of intersection for the shapes in this region.
   * Accounts for holes.
   * @param {PIXI.Point} a      A point on the line
   * @param {PIXI.Point} b      A second point on the line, not equal to the first
   * @returns {Segment2d[]} Segments, where a and b contain t0 representing their relative positions a --> b
   */
  allIntersectingSegmentsForLineSegment(a, b) {
    // Very difficult to do with PIXI shapes b/c order matters:
    // Each shape represents a level.
    // So if rect, ellipse hole, rectangle, rectangle: the hole affects the first rectangle, not the last two.
    // But if rect, rectangle, ellipse hole, rectangle: the hole affects the first two rectangles.

    // Process each layer in turn, building up the segments accordingly.
    const allSegments = [];
    for ( const shape of this.region.document.shapes ) {
      const pixiShape = this.getPixiShape(shape);
      const ixs = pixiShape.segmentIntersections(a, b, { tangents: false });
      if ( !ixs.length ) continue;

      // Add start and and of the segment.
      // Avoid duplicates.
      ixs.sort((a, b) => a.t0 - b.t0);
      if ( pixiShape.contains(a.x, a.y) && !ixs[0].t0.almostEqual(0) ) ixs.unshift({ x: a.x, y: a.y, t0: 0 });
      if ( pixiShape.contains(b.x, b.y) && !ixs.at(-1).t0.almostEqual(1) ) ixs.push({ x: b.x, y: b.y, t0: 1 });
      const nIxs = ixs.length;
      if ( nIxs < 2 ) continue;
      // Draw.clearDrawings()
      // ixs.forEach(ix => Draw.point(ix));
      // allSegments.forEach(s => Draw.segment(s));

      // Build segments from the intersections.
      const nIxSegments = Math.floor(nIxs * 0.5);
      const ixSegments = Array(nIxSegments); // If nIxs is 1, will be [].
      for ( let i = 1, j = 0; i < nIxs; i += 2 ) ixSegments[j++] = { a: ixs[i - 1], b: ixs[i], shape };
      if ( allSegments.length === 0 ) {
        if ( !shape.hole ) allSegments.push(...ixSegments);
        continue;
      }
      // ixSegments.forEach(s => Draw.segment(s))
      const currSegments = [...allSegments];
      allSegments.length = 0;

      if ( shape.hole ) {
        // Can assume the segments are sorted by t0.
        // Because the hole are also sorted, no need to revisit; move along the a-->b line.
        let hIdx = 0;
        segmentLoop: for ( const segment of currSegments ) {
          for ( ; hIdx < nIxSegments; ) {
            const hole = ixSegments[hIdx];
            // Draw.segment(segment)
            // Draw.segment(hole, { color: Draw.COLORS.red })

            // Order matters for these.

            // Case 1: Hole contains the segment: s.a|h.a --- s.b|h.b or h.a --- s.a --- s.b --- h.b
            if ( almostLessThan(hole.a.t0, segment.a.t0) && almostGreaterThan(hole.b.t0, segment.b.t0) ) continue segmentLoop; // Note skip of segment.

            // Case 2: Hole contained by segment:  s.a --- h.a --- h.b --- s.b
            else if ( hole.a.t0 > segment.a.t0 && hole.b.t0 < segment.b.t0 ) {
              allSegments.push({ a: segment.a, b: hole.a });
              segment.a = hole.b;
              hIdx++;
            }

            // Case 3: hole is before or at the segment:  h.a --- h.b|s.a --- s.b
            if ( almostLessThan(hole.b.t0, segment.a.t0) ) hIdx++;

            // Case 4: Hole is after the segment: s.a --- s.b|h.a --- h.b
            else if ( almostGreaterThan(hole.b.t0, segment.b.t0) ) break;

            // Case 5: hole runs into segment.a:  h.a --- s.a --- h.b --- s.b
            else if ( hole.b.t0.between(segment.a.t0, segment.b.t0, false) ) { segment.a = hole.b; hIdx++; }

            // Case 6: hole runs into segment.b: s.a --- h.a --- s.b --- h.b
            else if ( segment.b.t0.between(hole.a.t0, hole.b.t0, false) ) segment.b = hole.a;
          }
          allSegments.push(segment);
        }
      } else {
        // Can assume the segments are sorted by t0.
        // Because the new segments are also sorted, no need to revisit; move along the a-->b line.
        let iIdx = 0;
        for ( const segment of currSegments ) {
          for ( ; iIdx < nIxSegments; ) {
            const newS = ixSegments[iIdx]

            // Case 1: segment encompasses new segment: s.a|n.a --- n.b|s.b
            if ( almostLessThan(segment.a.t0, newS.a.t0) && almostGreaterThan(segment.b.t0, newS.b.t0) ) { iIdx++; break; }

            // Case 2: new segment encompasses segment: n.a --- s.a --- s.b --- n.b
            if ( segment.a.t0 > newS.a.t0 && segment.b.t0 < newS.b.t0 ) { segment.a = newS.a; segment.b = newS.b; }

            // Case 3: new segment linked at left: n.a --- n.b|s.a --- s.b
            if ( newS.b.t0.almostEqual(segment.a.t0) ) { segment.a = newS.a; iIdx++; }

            // Case 4: new segment entirely to the left: n.a --- n.b --- s.a --- s.b
            else if ( newS.b.t0 < segment.a.t0 ) { allSegments.push(newS); iIdx++; }

            // Case 5: new segment extends segment to the left: n.a --- s.a -- n.b --- s.b
            else if ( newS.a.t0 < segment.a.t0 && newS.b.t0 < segment.b.t0 ) { segment.a = newS.a; iIdx++; }

            // Case 6: new segment linked at right: s.a --- s.b|n.a --- n.b
            if ( newS.a.t0.almostEqual(segment.b.t0) ) { segment.b = newS.b; iIdx++; break; }

            // Case 7: new segment entirely to the right: s.a --- s.b --- n.a --- n.b
            else if ( newS.b.t0 > segment.a.t0 ) { break; }

            // Case 8: new segment extends segment to the right: s.a --- n.a -- s.b --- n.b
            else if ( newS.a.t0 > segment.a.t0 && newS.b.t0 > segment.b.t0 ) { segment.b = newS.b; break; }

          }
          allSegments.push(segment);
        }
      }
    }
    return allSegments;
  }

  /**
   * For a given 2d line, get the 3d segments representing traveling along the surface of this region.
   * @param {PIXI.Point} a      A point on the line
   * @param {PIXI.Point} b      A second point on the line, not equal to the first
   * @returns {ElevatedPoint[]}
   */
  surfaceSegments(a, b) {
    const segments2d = this.allIntersectingSegmentsForLineSegment(a, b);

    // Steps.
    if ( this.rampStepSize ) {
      if ( this.splitPolygons ) return segments2d.flatMap(({ a, b, shape }) => this._rampCutpointsForSegment(a, b, shape));
      else return segments2d.flatMap(({ a, b }) => this._rampCutpointsForSegment(a, b));
    }

    // Ramps.
    if ( this.isRamp ) return segments2d.map(({ a, b }) => ({
      a: ElevatedPoint.fromLocationWithElevation(a, this.elevationUponEntry(a)),
      b: ElevatedPoint.fromLocationWithElevation(b, this.elevationUponEntry(b)),
    }));

    // Plateaus.
    const elev = this.plateauElevation;
    return segments2d.map(({ a, b }) => ({
      a: ElevatedPoint.fromLocationWithElevation(a, elev),
      b: ElevatedPoint.fromLocationWithElevation(b, elev),
    }));
  }


  // ----- NOTE: Secondary methods ----- //

  /**
   * Calculate the plane of the plateau or ramp.
   * @param {object} minMax
   * @returns {Plane} If not a ramp, will return the horizontal plane
   */
  _plateauPlane(minMax) {
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
   * @param {ElevatedPoint} start          Start of the segment
   * @param {ElevatedPoint} end            End of the segment
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
    for ( const regionPoly of this.region.document.polygons ) {
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
   * @param {ElevatedPoint} start          Start of the segment
   * @param {ElevatedPoint} end            End of the segment
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
  /* Currently unusued
  #applyCutawayMethod(method, start, end, usePlateauElevation = true) {
    const result = [];
    let allHoles = true;
    const nonHolePolygons = (this.isRamp && this.splitPolygons) ? this.nonHolePolygons : [];
    for ( const regionPoly of this.region.document.polygons ) {
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
  */

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
   * @returns {PIXI.ElevatedPoint[]} Array of points from start to end at which elevation changes.
   */
  _rampCutpointsForSegment(a, b, poly) {
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
      const cutpoint0 = ElevatedPoint.fromLocationWithElevation(ix, startingElevation);
      const cutpoint1 = ElevatedPoint.fromLocationWithElevation(ix, idealCutpoint.elevation);
      cutpoint0.t0 = ix.t0;
      cutpoint1.t0 = ix.t0;
      cutpoints.push(cutpoint0, cutpoint1);
      startingElevation = idealCutpoint.elevation;
    }

    return cutpoints;
  }

  // ----- NOTE: Static methods ----- //

  /**
   * For a given region shape, get its corresponding PIXI.Shape.
   * @param {RegionShapeData} shapeData
   * @returns {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse}
   */
  static pixiShapeForRegionShape(shapeData) {
    switch ( shapeData.type ) {
      case "rectangle": return new PIXI.Rectangle(shapeData.x, shapeData.y, shapeData.width, shapeData.height);
      case "circle": return new PIXI.Circle(shapeData.x, shapeData.y, shapeData.radius);
      case "ellipse": return new PIXI.Ellipse(shapeData.x, shapeData.y, shapeData.radiusX, shapeData.radiusY);
      case "polygon": return new PIXI.Polygon(shapeData.points);
      default: console.error(`RegionElevationHandler|pixiShapeForRegionShape|${shapeData.type} not recognized!`, { shapeData });
    }
    return PIXI.Circle(shapeData.x, shapeData.y, 1); // Should not be reached.
  }


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
   * @param {ElevatedPoint} waypoint      2d location
   * @returns {number} The elevation of the ramp at this location.
   */
  _rampElevation(waypoint, useSteps = true, round = true) {
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
    if ( useSteps && this.rampStepSize ) {
      const cutPoints = this.getRampCutpoints(poly);
      const nearestPt = cutPoints.findLast(pt => pt.t.almostEqual(t0) || pt.t < t0);
      if ( !nearestPt ) return rampFloor;
      return nearestPt.elevation;
    }

    // Ramp is basic incline; no steps.
    const delta = plateauElevation - rampFloor;
    const out = rampFloor + (t0 * delta);
    return round ? Math.round(out) : out;
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
    // Note: in grid units to avoid recalculation later.
    const MIN_ELEV = -1e06;
    const MAX_ELEV = 1e06;
    const topE = Math.min(this.region.topE, MAX_ELEV);
    const bottomE = Math.max(this.region.bottomE, MIN_ELEV);
    const topElevationFn = usePlateauElevation
      ? pt => gridUnitsToPixels(this.elevationUponEntry({ ...pt, elevation: pixelsToGridUnits(pt.z) }))
      : _pt => topE;
    const bottomElevationFn = _pt => bottomE;
    return { topElevationFn, bottomElevationFn };
  }
}

// ----- NOTE: Scene floor handler ----- //

// Treat the scene floor like a region, infinite depth and set to the scene background elevation.

export class SceneElevationHandler {
  /** @type {number} */
  static get sceneFloor() { return canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0; }

  /** @type {boolean} */
  get isElevated() { return true; }

  /** @type {boolean} */
  get isPlateau() { return true; }

  get plateauElevation() { return this.constructor.sceneFloor; }

  get sceneFloor() { return this.scene.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0; }

  scene;

  constructor(scene) {
    this.scene = scene;
  }

  segmentInBounds(a, b, axes) { return this.pointInBounds(a, axes) || this.pointInBounds(b, axes); }

  pointInBounds(a, axes) {
    if ( axes && !Object.hasOwn(axes, "z") ) return true;
    return almostLessThan(a.elevation ?? pixelsToGridUnits(a.z) , this.sceneFloor);
  }

  test2dPoint(_a) { return true; }

  testPoint(a) { return almostLessThan(a.elevation, this.sceneFloor);  }

  pointLocation(pt) {
    const LOCS = RegionElevationHandler.ELEVATION_LOCATIONS;
    return pt.elevation.almostEqual(this.sceneFloor) ? LOCS.GROUND :
      pt.elevation > this.sceneFloor ? LOCS.ABOVE : LOCS.BELOW;
  }

  elevationUponEntry(_pt) { return this.sceneFloor; }

  locationIsOnTerrain(pt) {
    const elev = this.elevationUponEntry(pt);
    return pt.elevation.almostEqual(elev);
  }

  _cutaway(start, end) {
    const topElevationFn = _pt => this.sceneFloor;
    const bottomElevationFn = _pt => -1e06;
    return this.scene.dimensions.rect.cutaway(start, end, { topElevationFn, bottomElevationFn });
  }

  _cutawayIntersections(start, end) {
    const cutaways = this._cutaway(start, end);
    return cutaways.flatMap(cutaway => cutaway.intersectSegment3d(start, end));
  }

  surfaceSegments(a, b) {
    const elev = this.sceneFloor;
    return [{
      a: ElevatedPoint.fromLocationWithElevation(a, elev),
      b: ElevatedPoint.fromLocationWithElevation(b, elev),
    }];
  }

  lineSegmentIntersects(a, b) {
    const floor = this.sceneFloor;
    return almostLessThan(a, floor) || almostLessThan(b, floor);
  }

  segmentIntersections(a, b) {
    if ( a.z === b.z ) return [];
    const plane = new Plane(new Point3d(0, 0, gridUnitsToPixels(this.sceneFloor)));
    const ix = plane.lineSegmentIntersection(a, b);
    if ( !ix ) return [];
    const pt = ElevatedPoint.tmp.set(ix.x, ix.y, ix.z);
    pt.t0 = ix.t0;
    return [pt];
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
function minMaxPolygonPointsAlongAxis(poly, direction = 0, centroid) {
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
function rotatePolygon(poly, rotation = 0, centroid) {
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


function isOdd(number) { return (number & 1) === 1; }

function capitalizeFirstLetter(string) { return string.charAt(0).toUpperCase() + string.slice(1); }