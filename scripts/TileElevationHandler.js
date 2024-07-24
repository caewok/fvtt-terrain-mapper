/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { ElevationHandler } from "./ElevationHandler.js";

/**
 * Single tile elevation handler
 * Class that handles tiles as floors
 * Encapsulated inside Tile.prototype.terrainmapper class
 */
export class TileElevationHandler {
  /** @type {Tile} */
  tile;

  constructor(tile) {
    this.tile = tile;
  }

  // ----- NOTE: Getters ----- //

  /** @type {boolean} */
  get isElevated() {
    // No point in treating tile as elevated if it is on the scene floor.
    return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.IS_FLOOR)
        && this.tile.elevation !== ElevationHandler.sceneFloor;
  }

  /** @type {boolean} */
  get elevation() { return this.tile.document.elevation; }

  /** @type {Plane} */
  get plane() {
    return new Plane(new Point3d(0, 0, CONFIG.GeometryLib.utils.gridUnitsToPixels(this.elevation)));
  }

  // ----- NOTE: Methods ----- //

  /**
   * Does this segment intersect the tile?
   * TODO: Segments that touch the border only do not intersect the tile.
   * TODO: Segments that are inside a hole only do not intersect the tile.
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @returns {boolean}
   */
  lineSegmentIntersects(start, end) {
    // Handle the 2d case.
    if ( start.elevation === start.elevation ) {
      if ( start.elevation !== this.elevation ) return false;
      return this.tile.bounds.lineSegmentIntersects(start, end, { inside: true });
    }

    // Handle 3d case.
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const a = Point3d._tmp.copyFrom(start);
    a.z = gridUnitsToPixels(start.elevation);
    const b = Point3d._tmp2.copyFrom(end);
    b.z = gridUnitsToPixels(end.elevation);
    return this.plane.lineSegmentIntersects(a, b);
  }

  /**
   * Where does this line intersect the tile?
   * Must first use lineSegmentIntersects to test for holes, bounds.
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @returns {Point|null}
   */
  lineIntersection(start, end) {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const a = Point3d._tmp.copyFrom(start);
    a.z = gridUnitsToPixels(start.elevation);
    const b = Point3d._tmp2.copyFrom(end);
    b.z = gridUnitsToPixels(end.elevation);
    return this.plane.lineSegmentIntersection(a, b);
  }

  /**
   * Does a point lie on the tile?
   * @param {RegionMovementWaypoint} a
   * @returns {boolean}
   */
  pointOnTile(a) {
    if ( a.elevation !== this.tile.elevation ) return false;
    return this.lineSegmentIntersects({ ...a, elevation: a.elevation + 1 }, { ...a, elevation: a.elevation - 1 });
  }

  // ----- NOTE: Secondary methods ----- //

  /**
   * Construct the cutaway shapes for a segment that traverses this tile.
   * If no alpha border, this will be based on the tile bounds.
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @returns {ClipperPaths|null} The combined Clipper paths for the tile cutaway.
   */
  _cutaway(start, end) {
    // TODO: Handle transparent border
    // TODO: Handle holes
    if ( !this.isElevated ) return null;
    return this.#quadrangle2dCutaway(start, end, this.tile.bounds);
  }

  // ----- NOTE: Private methods ----- //

  /**
   * Construct a quadrangle for a cutaway along a line segment
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @param {PIXI.Polygon|PIXI.Rectangle} shape     A polygon or rectangle from the tile
   * @returns {PIXI.Polygon|null}
   */
  #quadrangle2dCutaway(start, end, shape, { isHole = false } = {}) {
    if ( !shape.lineSegmentIntersects(start, end, { inside: true }) ) return null;

    // Build the polygon slightly larger than start and end so that the start and end will
    // be correctly characterized (float/ground/underground)
    const paddedStart = PIXI.Point._tmp.copyFrom(start).towardsPoint(PIXI.Point._tmp2.copyFrom(end), -2);
    const paddedEnd = PIXI.Point._tmp.copyFrom(end).towardsPoint(PIXI.Point._tmp2.copyFrom(start), -2);
    paddedStart.elevation = start.elevation;
    paddedEnd.elevation = end.elevation;

    // Determine the appropriate endpoints.
    let a;
    let b;
    const ixs = shape.segmentIntersections(paddedStart, paddedEnd);

    switch ( ixs.length ) {
      case 0: { a = paddedStart; b = paddedEnd; break; }
      case 1: {
        const ix0 = ixs[0];
        if ( paddedStart.x === ix0.x && paddedStart.y === ix0.y ) {
          // Intersects only at start point. Infer that end is inside; go from start --> end.
          a = paddedStart;
          b = paddedEnd;
        } else if ( paddedEnd.x === ix0.x && paddedEnd.y === ix0.y ) {
          // Intersects only at end point.
          // Expand one pixel past the end location to get a valid polygon.
          a = paddedEnd;
          b = PIXI.Point._tmp.copyFrom(paddedEnd).towardsPoint(PIXI.Point._tmp2.copyFrom(paddedStart), -1);
        } else [a, b] = shape.contains(paddedStart.x, paddedStart.y) ? [paddedStart, ix0] : [ix0, paddedEnd];
        break;
      }
      case 2: {
        const ix0 = ixs[0];
        const ix1 = ixs[1];
        [a, b] = ix0.t0 < ix1.t0 ? [ix0, ix1] : [ix1, ix0];
        break;
      }
    }

    // Build the quadrangle
    // Give tiles a 1-pixel height so they are proper polygons in the cutaway.
    const toCutawayCoord = ElevationHandler._to2dCutawayCoordinate;
    a.elevation = this.elevation;
    b.elevation = this.elevation;
    const TL = toCutawayCoord(a, start);
    const TR = toCutawayCoord(b, start);
    const BL = { x: TL.x, y: a.elevation - 1 };
    const BR = { x: TR.x, y: b.elevation - 1 };
    return isHole ? new PIXI.Polygon(TL, TR, BR, BL) : new PIXI.Polygon(TL, BL, BR, TR);
  }




}