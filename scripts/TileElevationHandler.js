/* globals
AsyncWorker,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { RegionMovementWaypoint3d } from "./geometry/3d/RegionMovementWaypoint3d.js";
import { ElevationHandler } from "./ElevationHandler.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { regionWaypointsXYAlmostEqual } from "./util.js";
import { Draw } from "./geometry/Draw.js";

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
        && this.tile.elevationE !== ElevationHandler.sceneFloor;
  }

  /** @type {boolean} */
  get elevation() { return this.tile.document.elevation; }

  /** @type {Plane} */
  get plane() {
    return new Plane(new Point3d(0, 0, CONFIG.GeometryLib.utils.gridUnitsToPixels(this.elevation)));
  }

  /** @type {number} */
  get alphaThreshold() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.ALPHA_THRESHOLD); }

  /** @type {boolean} */
  get trimBorder() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.TRIM_BORDER); }

  /**
   * Border of the tile that removes the transparent alpha pixels along the edges.
   * @type {PIXI.Rectangle|PIXI.Polygon}
   */
  get alphaBorder() { return this.tile.evPixelCache.getThresholdCanvasBoundingBox(this.alphaThreshold); }

  /** @type {boolean} */
  get testHoles() { return this.tile.document.getFlag(MODULE_ID, FLAGS.TILE.TEST_HOLES); }

  /** @type {PixelCache} */
  #holeCache;

  get holeCache() { return this.#holeCache; }

  clearHoleCache() { this.#holeCache = undefined; }

  async buildHoleCache() {
    if ( !this.constructor.holeDetector ) {
      this.constructor.holeDetector = new HoleDetector();
      await this.constructor.holeDetector.initialize();
    }
    this.#holeCache = await this.#constructHoleCache();

  }

  // ----- NOTE: Methods ----- //

  /**
   * Does this segment intersect the tile?
   * TODO: Segments that touch the border only do not intersect the tile.
   * TODO: Segments that are inside a hole only do not intersect the tile.
   * @param {RegionMovementWaypoint3d} start          Start of the segment
   * @param {RegionMovementWaypoint3d} end            End of the segment
   * @returns {boolean}
   */
  lineSegmentIntersects(start, end) {
    if ( !(start instanceof RegionMovementWaypoint3d) ) start = RegionMovementWaypoint3d.fromObject(start);
    if ( !(end instanceof RegionMovementWaypoint3d) ) end = RegionMovementWaypoint3d.fromObject(end);

    // Handle the 2d case.
    if ( start.elevation === end.elevation ) {
      if ( start.elevation !== this.elevation ) return false;
      return this.tile.bounds.lineSegmentIntersects(start, end, { inside: true });
    }

    // Handle the vertical move case.
    if ( regionWaypointsXYAlmostEqual(start, end) ) {
      if ( !this.elevation.between(start.elevation, end.elevation) ) return false;
      return this.tile.bounds.contains(start.x, start.y);
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
   * @param {RegionMovementWaypoint3d} a
   * @returns {boolean}
   */
  waypointOnTile(a, token) {
    if ( !(a instanceof RegionMovementWaypoint3d) ) a = RegionMovementWaypoint3d.fromObject(a);
    if ( a.elevation !== this.tile.elevationE ) return false;
    if ( !this.tile.bounds.contains(a.x, a.y) ) return false;
    if ( !this.lineSegmentIntersects(
      { ...a, elevation: a.elevation + 1 },
      { ...a, elevation: a.elevation - 1 }) ) return false;
    if ( this.trimBorder
      && !this.tile.evPixelCache.getThresholdCanvasBoundingBox(this.alphaThreshold).contains(a.x, a.y) ) return false;
    if ( !(token && this.testHoles) ) return true;
    const holeCache = this.tile[MODULE_ID].holeCache;
    const holeThreshold = this.holeThresholdForToken(token);
    return holeCache.pixelAtCanvas(a.x, a.y) < holeThreshold;
  }

  /**
   * For a given 2d line through this tile, return the points at which holes start and stop.
   * @param {Point} a
   * @param {Point} b
   * @param {number} holeThreshold        In pixel coordinates, how large a hole counts?
   * @returns {object[]} Array of objects, each of which have:
   *   - {number} x           Canvas coordinates
   *   - {number} y           Canvas coordinates
   *   - {number} currPixel   The pixel value (tile pixel value for ending holes; count of hole size for hole starts)
   *   - {number} prevPixel   The previous pixel value
   *   - {boolean} holeStart  Is this the start of a hole?
   *   - {number} dist2       Where on the segment this point falls (for sorting): distance squared from a
   */
  holePositions(a, b, holeThreshold = 1) {
    if ( !this.isElevated || !this.testHoles ) return [];
    const holeCache = this.tile[MODULE_ID].holeCache;

    // Mark every time it moves from solid ground to a hole threshold of a given size.
    const markHoleStartFn = (currPixel, prevPixel) => prevPixel < holeThreshold && currPixel >= holeThreshold;
    const holeStarts = holeCache._extractAllMarkedPixelValuesAlongCanvasRay(a, b, markHoleStartFn, { skipFirst: true });
    holeStarts.forEach(pt => pt.holeStart = true);

    // Mark the opposite move, from a hole to solid ground.
    const markHoleEndFn = (currPixel, prevPixel) => prevPixel >= holeThreshold && currPixel < holeThreshold;
    const holeEnds = holeCache._extractAllMarkedPixelValuesAlongCanvasRay(a, b, markHoleEndFn, { skipFirst: true });
    holeEnds.forEach(pt => pt.holeStart = false);

    // Locate holes outside the alpha = 0 border.
    const outerHoles = this._findOuterHoles(a, b, holeThreshold);

    // Sort by distance squared from a.
    const holes = [...holeStarts, ...holeEnds, ...outerHoles];
    holes.forEach(pt => pt.dist2 = PIXI.Point.distanceSquaredBetween(a, pt));
    holes.sort((a, b) => a.dist2 - b.dist2);

    // If the first pixel is in the bounds of the tile, add it.
    if ( holes.length && regionWaypointsXYAlmostEqual(holes[0], a) ) return holes;
    const startValue = holeCache.pixelAtCanvas(a.x, a.y);
    if ( startValue !== null
      && startValue < holeThreshold ) holes.unshift({ ...a, holeStart: false, isStart: true, dist2: 0 });
    return holes;
  }

  /**
   * For a given line outside the hole cache, determine the point at which it is no longer
   * a hole for a given threshold.
   * This point is a specified distance from the edge.
   * @param {Point} a
   * @param {Point} b
   * @param {number} holeThreshold        In pixel coordinates, how large a hole counts?
   * @returns {PIXI.Point[]} Zero, one, or two points where the hole stops and starts
   *   Two points if the line intersects two edges; one point if a or b is inside
   */
  _findOuterHoles(a, b, holeThreshold = 1) {
    if ( !this.isElevated || !this.testHoles ) return [];
    const holeCache = this.tile[MODULE_ID].holeCache;

    // Easiest to do this in local space, to take advantage of the rectangle.
    a = holeCache._fromCanvasCoordinates(a.x, a.y);
    b = holeCache._fromCanvasCoordinates(b.x, b.y);
    const ixs = holeCache.segmentIntersections(a, b);

    // Can have 0, 1, or 2 outer segments.
    const outerSegments = [];
    switch ( ixs.length ) {
      case 0: {
        if ( holeCache.contains(a.x, a.y) ) return []; // Both a and b are inside.
        const paddedCache = new PIXI.Rectangle();
        holeCache.copyTo(paddedCache);
        paddedCache.pad(holeThreshold);
        if ( !paddedCache.lineSegmentIntersects(a, b, { inside: true }) ) return []; // A|b never comes close enough
        outerSegments.push({ a, b }); // Both a and b are outside.
        break;
      }
      case 1: {
        if ( holeCache.contains(a.x, a.y) ) outerSegments.push({ a: ixs[0], b });
        else outerSegments.push({ a, b: ixs[0] });
        break;
      }
      case 2: {
        outerSegments.push({ a, b: ixs[0] }, { a: ixs[1], b });
        break;
      }
    }

    // Padding the border by holeThreshold gets us the point beyond which the segment is
    // definitely a hole.
    // The catch is that if the a|b segment moves toward a gap in the tile (e.g., a U shape)
    // then it should continue to be a hole through that gap.
    // For each pixel along that line, need to get its distance from the perpendicular intersection with the border.
    // Could use a full pixel offset window but that would test a lot of unnecessary pixels.
    // Instead, get perpendicular border intersection and minimum hole value along the border.
    const bresenhamLineIterator = CONFIG.GeometryLib.utils.bresenhamLineIterator;
    const closestPointToSegment = foundry.utils.closestPointToSegment;
    const CSZ = PIXI.Rectangle.CS_ZONES;
    const edges = {
      [CSZ.LEFT]: holeCache.leftEdge,
      [CSZ.TOP]: holeCache.topEdge,
      [CSZ.RIGHT]: holeCache.rightEdge,
      [CSZ.BOTTOM]: holeCache.bottomEdge
    };

    const holes = [];
    const holeThreshold_1_2 = holeThreshold * 0.5;
    for ( const outerS of outerSegments ) {
      let currHole = !holeCache.contains(outerS.a.x, outerS.a.y);
      for ( const pt of bresenhamLineIterator(outerS.a, outerS.b) ) {
        // Either the edge is L/R/T/B or is one of the corners, e.g. TOP_LEFT.
        const z = holeCache._getZone(pt);
        if ( !z ) continue; // Point is inside.
        const closestEdge = edges[z]
          || edges[z & CSZ.TOP]
          || edges[z & CSZ.RIGHT]
          || edges[z & CSZ.BOTTOM]
          || edges[z & CSZ.LEFT];
        const closestEdgePt = closestPointToSegment(pt, closestEdge.A, closestEdge.B);

        // Distance + edge point value must exceed the holeThreshold for this to be a hole.
        // If it does, then every pixel along the edge up to holeThreshold / 2 must also meet that value.
        const dist = Math.ceil(PIXI.Point.distanceBetween(pt, closestEdgePt));
        const targetValue = holeThreshold - dist;

        let isHole;
        if ( targetValue < 1 ) isHole = true;
        else if ( holeCache._pixelAtLocal(pt.x, pt.y) < targetValue ) isHole = false;
        else {
          const markPixelFn = currPixel => currPixel < targetValue;
          const edgeDir = PIXI.Point._tmp2.copyFrom(closestEdge.B)
            .subtract(closestEdge.A, PIXI.Point._tmp3).normalize();
          const res = holeCache._extractNextMarkedPixelValueAlongLocalRay(
            PIXI.Point._tmp.copyFrom(closestEdgePt).subtract(edgeDir.multiplyScalar(holeThreshold_1_2)),
            PIXI.Point._tmp2.copyFrom(closestEdgePt).add(edgeDir.multiplyScalar(holeThreshold_1_2)), markPixelFn);
          isHole = !res;
        }
        if ( !(currHole ^ isHole) ) continue;
        pt.holeStart = !currHole;
        holes.push(pt);
        currHole = isHole;
      }
    }
    return holes.map(pt => holeCache._toCanvasCoordinates(pt.x, pt.y, pt));
  }

  /**
   * For a token traveling along a 2d line through this tile, determine its hole threshold.
   * The threshold is dependent on tile resolution and token size.
   * @param {Token} token
   * @returns {number} The hole threshold, in number of local pixels for the tile.
   */
  holeThresholdForToken(token) {
    const tokenPercentHoleThreshold = CONFIG[MODULE_ID].tokenPercentHoleThreshold;
    const holeThreshold = Math.max(token.w, token.h) * tokenPercentHoleThreshold;

    // If the tile resolution is not 1, the hole threshold varies proportionally.
    const tileCache = this.tile.evPixelCache;
    return holeThreshold * tileCache.scale.resolution;
  }


  // ----- NOTE: Secondary methods ----- //

  /**
   * Construct the cutaway shapes for a segment that traverses this tile.
   * If no alpha border, this will be based on the tile bounds.
   * @param {Point3d} start          Start of the segment
   * @param {Point3d} end            End of the segment
   * @param {Token} [token]          Token doing the movement; required for holes
   * @returns {ClipperPaths|null} The combined Clipper paths for the tile cutaway.
   */
  _cutaway(start, end, token) {
    if ( !this.isElevated ) return null;
    const polys = token && this.testHoles
      ? this.#cutawayPolygonsHoles(start, end, this.holeThresholdForToken(token))
      : this.#cutawayPolygonsNoHoles(start, end);
    if ( !polys.length ) return null;
    const regionPath = ClipperPaths.fromPolygons(polys);
    const combined = regionPath.combine().clean();
    return combined;
  }

  /**
   * Cutaway polygons for a basic border only, no holes.
   * @param {Point3d} start          Start of the segment
   * @param {Point3d} end            End of the segment
   * @returns {PIXI.Polygon[]} The polygon for the cutaway (if any), in an array.
   */
  #cutawayPolygonsNoHoles(start, end) {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
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
   * @returns {PIXI.Polygon[]} The polygons for the cutaway (if any)
   */
  #cutawayPolygonsHoles(start, end, holeThreshold = 1) {
    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
    const holePositions = this.holePositions(start, end, holeThreshold);
    if ( !holePositions.length ) return [];// Return this.#cutawayPolygonsNoHoles(start, end);

    // Give tiles a 1-pixel height so they are proper polygons in the cutaway.
    // Use grid units for elevation.
    const topE = gridUnitsToPixels(this.elevation);
    const bottomE = topE - gridUnitsToPixels(1);
    const topElevationFn = _pt => topE;
    const bottomElevationFn = _pt => bottomE;

    // Starting outside the tile and moving until we hit something.
    const polys = [];
    const bounds = this.alphaBorder;
    let a = PIXI.Point.fromObject(holePositions[0]);
    let onTile = !a.holeStart;
    if ( holePositions.length === 1 && onTile ) {
      const quads = bounds.cutaway(a, end,
        { start, end, topElevationFn, bottomElevationFn });
      if ( quads.length ) return quads;
    }
    for ( let i = 1, n = holePositions.length; i < n; i += 1 ) {
      const b = PIXI.Point.fromObject(holePositions[i]);
      if ( onTile && b.holeStart ) {
        const quads = bounds.cutaway(a, b,
          { start, end, topElevationFn, bottomElevationFn });
        if ( quads.length ) polys.push(...quads);
        onTile = false;
        a = b;
      } else if ( !onTile && !b.holeStart ) {
        onTile = true;
        a = b;
      }
    }
    return polys;
  }

  // ----- NOTE: Private methods ----- //

  /**
   * Construct a pixel cache for the local values of the tile, in which every pixel
   * that is a hole (transparent alpha) has its value set to the smallest number of pixels
   * between the pixel and the next non-transparent pixel.
   * So if a pixel has value 3, then you can go 3 pixels in any direction before hitting a
   * non-transparent pixel.
   * @returns {PixelArray}
   */
  async #constructHoleCache() {
    // First construct a pixel array where 0 = no alpha and 1 = alpha.
    // Then iterate through each pixel:
    // If 0, move to next
    // Check surrounding 8 pixels.
    // - Take lowest, ignoring pixels outside border. Add 1 and set pixel to this sum.
    // - If changed, flag because the 8 neighbors must be retested after iteration is finished.
    // Until no more changes: update the 8 neighbors of each changed pixel.
    const { alphaThreshold, tile } = this;
    const tileCache = tile.evPixelCache;
    const holeCache = tileCache.constructor.fromOverheadTileAlpha(tile, tileCache.scale.resolution);

    // Set each alpha pixel to the max integer value to start, 0 otherwise.
    console.group(`${MODULE_ID}|constructHoleCache ${this.tile.id}`);
    const alphaPixelThreshold = tileCache.maximumPixelValue * alphaThreshold;
    if ( CONFIG[MODULE_ID].debug ) {
      holeCache.pixels = calculateHoleCachePixelsSync(tileCache.pixels, tileCache.width, alphaPixelThreshold);
    } else {
      holeCache.pixels = await this.constructor.holeDetector.calculateHoleCachePixels(tileCache.pixels,
        tileCache.width, alphaPixelThreshold);
    }

    // HoleCache.pixels = this.#calculateHoleCachePixels(tileCache.pixels, tileCache.width, alphaPixelThreshold);
    console.groupEnd(`${MODULE_ID}|constructHoleCache ${this.tile.id}`);
    return holeCache;
    // AvgPixels(holeCache.pixels); // 1.33
    // drawPixels(holeCache)
    // drawHoles(holeCache)
    // pixelCounts(holeCache, max = 10)
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Construct a count of the number of pixels that have specific values.
   * @param {number} [max=1]      Values below this are explicitly counted; above summed
   * @returns {object} Object with numbered properties containing counts
   */
  pixelCounts(max = 1) {
    const countsArr = Array.fromRange(max + 1);
    const out = {};
    const holeCache = this.holeCache;
    for ( const ct of countsArr ) {
      const fn = holeCache.constructor.pixelAggregator("count_eq_threshold", ct);
      out[ct] = fn(holeCache.pixels).count;
    }
    const gtFn = holeCache.constructor.pixelAggregator("count_gt_threshold", max);
    const gtRes = gtFn(holeCache.pixels);
    out[`> ${max}`] = gtRes.count;
    out.numPixels = gtRes.numPixels;
    return out;
  }

  /**
   * Draw pixels below, equal to, or above a threshold.
   * Below: green; at threshold: orange; above threshold: red
   * @param {number} [threshold = 1]    The value to test
   * @param {object} [opts]
   * @param {number} [opts.skip=10]     Only draw every x pixel
   * @param {number} [opts.radius=2]    Draw each pixel at this size (1 to match the canvas pixels)
   * @param {boolean} [opts.local=true] Draw the local pixels (at 0,0) or the canvas pixels
   */
  drawPixelsAtThreshold(threshold = 1, { skip = 10, radius = 2, local=true } = {}) {
    const holeCache = this.holeCache;
    const { right, left, top, bottom } = holeCache;
    const drawFn = local
      ? (x, y, color) => Draw.point({x, y}, { color, alpha: 0.8, radius })
      : (x, y, color) => {
        const canvasPt = holeCache._toCanvasCoordinates(x, y, PIXI.Point._tmp);
        Draw.point(canvasPt, { color, alpha: 0.8, radius });
      };

    for ( let x = left; x <= right; x += skip ) {
      for ( let y = top; y <= bottom; y += skip ) {
        const value = holeCache._pixelAtLocal(x, y);
        let color;
        if ( !value ) continue;
        else if ( value < threshold ) color = Draw.COLORS.green;
        else if ( value === threshold ) color = Draw.COLORS.orange;
        else color = Draw.COLORS.red;
        drawFn(x, y, color);
      }
    }
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

// ----- NOTE: Helper functions ---- //

/**
 * For this rectangular frame of local pixels, step backward or forward in the x and y directions
 * from a current index. Presumes index is row-based, such that:
 * 0 1 2 3
 * 4 5 6 7...
 * @param {number} currIdx
 * @param {number} [xStep = 0]
 * @param {number} [yStep = 0]
 * @returns {number} The new index position
 */
function localPixelStep(currIdx, localWidth, xStep = 0, yStep = 0) {
  return currIdx + (yStep * localWidth) + xStep;
}

/**
 * Test if a number falls between two other numbers. For worker.
 * @param {number} n    Number to test
 * @param {number} min  Smaller number
 * @param {number} max  Larger number
 * @param {boolean} [inclusive=true]  If true, include min and max
 * @returns {boolean}
 */
function between(n, min, max, inclusive=true) {
  return inclusive ? (n >= min) && (n <= max) : (n > min) && (n < max);
}

/**
 * Indices of the 8 neighbors to this local pixel index. Does not
 * @param {number} currIdx
 * @returns {number[]}
 */
function localNeighborIndices(pixels, currIdx, localWidth, trimBorder = true) {
  const arr = [];
  const maxIdx = pixels.length - 1;
  for ( let xi = -1; xi < 2; xi += 1 ) {
    for ( let yi = -1; yi < 2; yi += 1 ) {
      if ( !(xi || yi) ) continue;
      const neighborIdx = localPixelStep(currIdx, localWidth, xi, yi);
      if ( trimBorder && !between(neighborIdx, 0, maxIdx) ) continue;
      arr.push(neighborIdx);
    }
  }
  return arr;
}

/**
 * Retrieve the 8 neighbors to a given index on the local cache.
 * @param {number} currIdx
 * @param {boolean} [trimBorder=true]    If true, exclude the border values
 * @returns {number[]} The values, in column order, skipping the middle value.
 */
function localNeighbors(pixels, currIdx, localWidth, trimBorder = true) {
  return localNeighborIndices(pixels, currIdx, localWidth, trimBorder).map(idx => pixels[idx]);
}

function calculateHoleCachePixelsSync(tileCachePixels, width, alphaPixelThreshold = 191.25) {
  const res = calculateHoleCachePixels([{ tileCachePixels, width, alphaPixelThreshold }]);
  return res[0].holeCachePixels;
}

/**
 * Placeholder for eventual worker method that takes the tile array and constructs a hole array
 * @param {Uint8Array} tileCachePixels      The pixel array for a tile
 * @param {number} width                    The local width of the tile cache
 * @param {number} alphaPixelThreshold      Value between 0 and 255; above this is non-transparent.
 *                                          Default is alphaThreshold = 75%
 * @returns {Uint16Array} The hole cache array
 */
function calculateHoleCachePixels({ tileCachePixels, width, alphaPixelThreshold = 191.25 } = {}) {
  const MODULE_ID = "terrainmapper";
  const MAX_VALUE = 65535; // Uint16Array maximum.
  const nPixels = tileCachePixels.length;
  const holeCachePixels = new Uint16Array(nPixels);

  // Set each alpha pixel to the max integer value to start, 0 otherwise.
  console.time(`${MODULE_ID}|Mark each alpha pixel`);
  for ( let i = 0; i < nPixels; i += 1 ) holeCachePixels[i] = tileCachePixels[i] > alphaPixelThreshold ? 0 : MAX_VALUE;
  console.timeEnd(`${MODULE_ID}|Mark each alpha pixel`); // 6.5 ms.
  // avgPixels(holeCache.pixels); // 0.66
  // drawPixels(holeCache)
  // drawHoles(holeCache)
  // pixelCounts(holeCache, max = 1) // {0: 616231, 1: 0, > 1: 1408769, numPixels: 2025000}

  const changedIndices = new Set();
  const updatePixel = idx => {
    const value = holeCachePixels[idx];
    if ( !value ) return;
    const newValue = Math.min(MAX_VALUE, Math.min(...localNeighbors(holeCachePixels, idx, width)) + 1);
    if ( value === newValue ) return;
    holeCachePixels[idx] = newValue;
    changedIndices.add(idx);
  };

  // For each pixel that is greater than 0, its value is 1 + min of 8 neighbors.
  // Record changed indices so we can re-process those neighbors.
  console.time(`${MODULE_ID}|Iterate over every pixel`);
  for ( let i = 0; i < nPixels; i += 1 ) updatePixel(i);
  console.timeEnd(`${MODULE_ID}|Iterate over every pixel`); // 100 ms
  // avgPixels(holeCache.pixels); // 1.33
  // drawPixels(holeCache)
  // drawHoles(holeCache)
  // pixelCounts(holeCache, max = 2) // {0: 616231, 1: 11632, 2: 7360, > 2: 1389777, numPixels: 2025000}

  const MAX_ITER = 1000;
  console.time(`${MODULE_ID}|Update pixels`);
  let iter = 0;
  while ( changedIndices.size && iter < MAX_ITER ) {
    iter += 1;
    const indices = [...changedIndices.values()];
    changedIndices.clear();
    for ( const idx of indices ) {
      const neighborIndices = localNeighborIndices(holeCachePixels, idx, width);
      for ( const neighborIdx of neighborIndices ) updatePixel(neighborIdx);
    }
  }
  console.timeEnd(`${MODULE_ID}|Update pixels`); // 28801.6630859375 ms // 11687.419189453125 ms using pixelStep instead of x,y.
  console.log(`${MODULE_ID}|${iter} iterations.`);
  return [{holeCachePixels}];
}

/**
 * Wrapper for a web worker meant to quantify the holes for a given array of pixels.
 * Holes in this case are the number of spaces one has to move before encountering a pixel of value 0 (solid).
 * So 5 means no 0 values within 5 pixels of this pixel.
 * @param {string} name                            The worker name to be initialized
 * @param {object} [config={}]                     Worker initialization options
 * @param {boolean} [config.debug=false]           Should the worker run in debug mode?
 */
export class HoleDetector extends AsyncWorker {
  constructor(name = `${MODULE_ID}|Hole Detector`, config = {}) {
    // Config.scripts ??= ["Data/modules/terrainmapper/scripts/workers/hole_detector.js"];
    config.loadPrimitives ??= false;
    super(name, config);
  }

  async initialize() {
    await this.loadFunction("between", between);
    await this.loadFunction("localPixelStep", localPixelStep);
    await this.loadFunction("localNeighborIndices", localNeighborIndices);
    await this.loadFunction("localNeighbors", localNeighbors);
    await this.loadFunction("calculateHoleCachePixels", calculateHoleCachePixels);
  }

  /**
   * Worker method that takes the tile array and constructs a hole array.
   * @param {Uint8Array} tileCachePixels      The pixel array for a tile
   * @param {number} width                    The local width of the tile cache
   * @param {number} alphaPixelThreshold      Value between 0 and 255; above this is non-transparent.
   *                                          Default is alphaThreshold = 75%
   * @returns {Uint16Array} The hole cache array
   */
  async calculateHoleCachePixels(tileCachePixels, width, alphaPixelThreshold = 191.25) {
    const res = await this.executeFunction("calculateHoleCachePixels", [{ tileCachePixels, width, alphaPixelThreshold }]);
    return res.holeCachePixels;
  }
}

