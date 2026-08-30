/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { trimCutawayPolygonWithVerticalHole } from "./util.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "./geometry/const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { gridUnitsToPixels } from "./geometry/util.js";

/**
 * Single tile elevation handler
 * Class that handles tiles as floors
 * Encapsulated inside Tile.prototype.terrainmapper class
 */
export class TileElevationHandler {
  /** @type {HoleDetector} */
  static holeDetector;

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
        && this.tile.elevationE !== canvas.scene[MODULE_ID].sceneFloor;
  }

  /** @type {boolean} */
  get elevation() { return this.tile.document.elevation; }

  /** @type {Plane} */
  get plane() {
    return new Plane(new Point3d(0, 0, gridUnitsToPixels(this.elevation)));
  }

  /** @type {number} */
  get alphaThreshold() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.ALPHA_THRESHOLD); }

  /** @type {boolean} */
  get trimBorder() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.TRIM_BORDER); }

  /**
   * Border of the tile that removes the transparent alpha pixels along the edges.
   * @type {PIXI.Rectangle|PIXI.Polygon}
   */
  get alphaBorder() {
    const geom = this.tile[GEOMETRY_LIB_ID][GEOMETRY_ID];
    return geom.alphaBoundingPolygon.top.toPolygon2d(); // Parallel to XY plane, so can just drop z axis.
  }

  get alphaPolygons() {
    const geom = this.tile[GEOMETRY_LIB_ID][GEOMETRY_ID];
    return geom.alphaThresholdPolygons.top.toPolygon2d();
  }

  /** @type {boolean} */
  get testHoles() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.TEST_HOLES); }

  /** @type {Map} */
  #holeCache = new Map();

  get holeCache() { return this.#holeCache; }

  clearHoleCache() { this.#holeCache.clear(); }

  // ----- NOTE: Methods ----- //

  /**
   * For a token traveling along a 2d line through this tile, determine its hole threshold.
   * The threshold is dependent on tile resolution and token size.
   * @param {Token} token
   * @returns {number} The hole threshold, in number of local pixels for the tile.
   */
  holeThresholdForToken(token) {
    const tokenPercentHoleThreshold = CONFIG[MODULE_ID].tokenPercentHoleThreshold;
    return Math.max(token.w, token.h) * tokenPercentHoleThreshold;
  }


  // ----- NOTE: Secondary methods ----- //

  /**
   * Construct the cutaway shapes for a segment that traverses this tile.
   * If no alpha border, this will be based on the tile bounds.
   * @param {Point3d} start          Start of the segment
   * @param {Point3d} end            End of the segment
   * @param {Token} [token]          Token doing the movement; required for holes
   * @returns {CutawayPolygon[]} The combined Clipper paths for the tile cutaway.
   */
  _cutaway(start, end, token) {
    if ( !this.isElevated ) return null;
    return token && this.testHoles
      ? this.#cutawayPolygonsHoles(start, end, this.holeThresholdForToken(token))
      : this.#cutawayPolygonsNoHoles(start, end);
  }

  /**
   * Cutaway polygons for a basic border only, no holes.
   * @param {Point3d} start          Start of the segment
   * @param {Point3d} end            End of the segment
   * @returns {CutawayPolygon[]} The polygon for the cutaway (if any), in an array.
   */
  #cutawayPolygonsNoHoles(start, end) {
    const bounds = this.trimBorder ? this.alphaBorder : this.tile.bounds;

    // Give tiles a 1-pixel height so they are proper polygons in the cutaway.
    // Use grid units for elevation.
    const topE = gridUnitsToPixels(this.elevation);
    const bottomE = topE - gridUnitsToPixels(1);
    const topElevationFn = _pt => topE;
    const bottomElevationFn = _pt => bottomE;
    return bounds.cutaway(start, end, { topElevationFn, bottomElevationFn });
  }

  /**
   * Cutaway for a border considering holes
   * @param {Point3d} start          Start of the segment
   * @param {Point3d} end            End of the segment
   * @param {number} holeThreshold                  The hole threshold to use
   * @returns {CutawayPolygon[]} The polygons for the cutaway (if any)
   */
  #cutawayPolygonsHoles(start, end, holeThreshold = 0) {
    // Give tiles a 1-pixel height so they are proper polygons in the cutaway.
    // Use grid units for elevation.
    const topE = gridUnitsToPixels(this.elevation);
    const bottomE = topE - gridUnitsToPixels(1);
    const topElevationFn = _pt => topE;
    const bottomElevationFn = _pt => bottomE;

    // Start with the polygons for the tile, which contain all holes.
    // Determine if we have any holes to deal with.
    const areaThreshold = holeThreshold ** 2;
    let hasHoles = false;
    const polys2d = this.alphaPolygons
      .filter(poly => {
        const isSolid = poly.isPositive;
        hasHoles ||= isSolid;
        return isSolid || (poly.area > areaThreshold);
      });
    if ( !hasHoles ) return polys2d.flatMap(poly => poly.cutaway(start, end, { topElevationFn, bottomElevationFn }));

    // For testing holes, create the start-->end sweep path using holeThreshold as the width.
    using start2d = start.to2d();
    using end2d = end.to2d();
    using dir = end2d.subtract(start2d);
    dir.normalize(dir);
    using cross = PIXI.Point.tmp.set(dir.y, -dir.x);
    cross.multiplyScalar(holeThreshold * 0.5, cross);
    const sweep = new PIXI.Polygon(
      start2d.add(cross),
      end2d.add(cross),
      end2d.subtract(cross),
      start2d.subtract(cross)
    );

    // Get the cutaway for each.
    // Trim by area first.
    // TODO: Is first trimming by area worth it?

    let processedCutaways = [];
    for ( const poly of polys2d ) {
      // Similar to RegionElevationHandler#_cutaway.
      if ( poly.isPositive ) processedCutaways.push(...poly.cutaway(start, end, { topElevationFn, bottomElevationFn }));

      else {
        // If not sufficiently large hole, skip.
        if ( !willFallIn(poly, sweep, holeThreshold) ) continue;
        const holeCutaways = poly.cutaway(start, end, { topElevationFn, bottomElevationFn })
          .filter(cutaway => {
            // Additional test to confirm width is sufficient to fall in.
            const bounds = cutaway.getBounds();
            return bounds.width > holeThreshold;
          });
        if ( !holeCutaways.length ) continue;

        // It's a hole. Cut all accumulated polygons before it.
        const updatedPolygons = [];
        for ( const parentPoly of processedCutaways ) {
          for ( const holePoly of holeCutaways ) {
            const trimmedPolys = trimCutawayPolygonWithVerticalHole(parentPoly, holePoly);
            updatedPolygons.push(...trimmedPolys);
          }
        }
        processedCutaways = updatedPolygons;

      }
    }

    return processedCutaways;
  }

}

/**
 * Flag if a hole's shape is large enough to swallow a square object anywhere along the
 * object's movement path.
 * @param {PIXI.Polygon} pixiHole         The complex hole
 * @param {PIXI.Polygon} pixiSweep        The rectangle/polygon of the movement path.
 * @param {number} objectSize             Width/height of the square to test
 * @returns {boolean} True if the object will fall in
 */
function willFallIn(pixiHole, pixiSweep, objectSize) {
  const ClipperPaths = CONFIG.GeometryLib.CONFIG.ClipperPaths;

  // Reverse the hole orientation so we can handle it like a regular polygon.
  pixiHole = pixiHole.clone().reverseOrientation();

  // Erode the hole to find the danger zone, where the object's center could be swallowed.
  const holePaths = ClipperPaths.fromPolygons([pixiHole]);
  const shrinkDistance = objectSize * 0.5;
  const dangerZone = holePaths.pad(-shrinkDistance);

  // If the hole disappears, it is safe everywhere.
  if ( dangerZone.area.almostEqual(0) ) return false;

  // Erode the sweep to find the center path.
  // Shrink by slightly less than half the size to prevent it from collapsing to 0.
  const epsilon = 0.1;
  const sweepPaths = ClipperPaths.fromPolygons([pixiSweep]);
  const centerPathSliver = sweepPaths.pad(-(shrinkDistance - epsilon));
  if ( centerPathSliver.area.almostEqual(0) ) return false;

  // Intersect the danger zone with the center sliver.
  // Any intersection is where the object would fall in.
  const ixPath = dangerZone.intersectPaths(centerPathSliver);
  return !ixPath.area.almostEqual(0);
}

