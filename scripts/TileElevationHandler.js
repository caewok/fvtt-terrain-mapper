/* globals
canvas,
CONFIG,
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
    const polys2d = this.alphaPolygons;

    // Get the cutaway for each.
    // Trim by area first.
    // TODO: Is first trimming by area worth it?
    const areaThreshold = holeThreshold ** 2;
    let processedCutaways = [];
    for ( const poly of polys2d ) {
      // Similar to RegionElevationHandler#_cutaway.
      if ( poly.isPositive ) processedCutaways.push(...poly.cutaway(start, end, { topElevationFn, bottomElevationFn }));

      else {
        // If not sufficiently large hole, skip.
        if ( poly.area < areaThreshold ) continue;
        const holeCutaways = poly.cutaway(start, end, { topElevationFn, bottomElevationFn })
          .filter(cutaway => {
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

/*
TileElevationHandler.js:345 terrainmapper|constructHoleCache mC8FvDWgb3da4m3g
TileElevationHandler.js:349 terrainmapper|Mark each alpha pixel: 3.1689453125 ms
TileElevationHandler.js:370 terrainmapper|Iterate over every pixel: 78.195068359375 ms
TileElevationHandler.js:388 terrainmapper|Update pixels: 467.125 ms
TileElevationHandler.js:389 terrainmapper|132 iterations.

TileElevationHandler.js:345 terrainmapper|constructHoleCache 6tV5ynPSXgSA04X6
TileElevationHandler.js:349 terrainmapper|Mark each alpha pixel: 3.134033203125 ms
TileElevationHandler.js:370 terrainmapper|Iterate over every pixel: 180.170166015625 ms
TileElevationHandler.js:388 terrainmapper|Update pixels: 1013.5439453125 ms
TileElevationHandler.js:389 terrainmapper|280 iterations.

*/
