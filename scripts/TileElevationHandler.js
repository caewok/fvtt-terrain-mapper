/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Plane } from "./geometry/3d/Plane.js";
import { ElevationHandler } from "./ElevationHandler.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { regionWaypointsXYEqual } from "./util.js";

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

  get holeCache() { return this.#holeCache || (this.#holeCache = this.#constructHoleCache()); }

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
  waypointOnTile(a) {
    if ( a.elevation !== this.tile.elevation ) return false;
    return this.lineSegmentIntersects({ ...a, elevation: a.elevation + 1 }, { ...a, elevation: a.elevation - 1 });
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
    const tileCache = this.tile.evPixelCache;
    const holeCache = this.tile[MODULE_ID].holeCache;

    // Mark every time it moves from solid ground to a hole threshold of a given size.
    const alphaThreshold = this.alphaThreshold;
    const markHoleStartFn = (currPixel, prevPixel) => prevPixel < holeThreshold && currPixel >= holeThreshold;
    const holeStarts = holeCache._extractAllMarkedPixelValuesAlongCanvasRay(a, b, markHoleStartFn, { alphaThreshold, skipFirst: true });

    // Mark every time it moves from transparent to non-transparent.
    const threshold = tileCache.maximumPixelValue * alphaThreshold;
    const markHoleEndFn = (currPixel, prevPixel) => prevPixel <= threshold && currPixel > threshold;
    const holeEnds = tileCache._extractAllMarkedPixelValuesAlongCanvasRay(a, b, markHoleEndFn, { alphaThreshold, skipFirst: true });

    // Sort by distance squared from a.
    holeStarts.forEach(pt => pt.holeStart = true);
    holeEnds.forEach(pt => pt.holeStart = false);
    const holes = [...holeStarts, ...holeEnds];
    holes.forEach(pt => pt.dist2 = PIXI.Point.distanceSquaredBetween(a, pt));
    holes.sort((a, b) => a.dist2 - b.dist2);

    // If the first pixel is in the bounds of the tile, add it.
    if ( tileCache.containsPixel(a.x, a.y, alphaThreshold)
      && tileCache.pixelAtCanvas(a.x, a.y) >= threshold) holes.unshift({ ...a, holeStart: false, isStart: true, dist2: 0 });

    return holes;
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
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @param {Token} [token]                         Token doing the movement; required for holes
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
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @returns {PIXI.Polygon[]} The polygon for the cutaway (if any), in an array.
   */
  #cutawayPolygonsNoHoles(start, end) {
    const bounds = this.trimBorder ? this.alphaBorder : this.tile.bounds;
    const quad = this.#quadrangle2dCutaway(start, end, bounds);
    return quad ? [quad] : [];
  }

  /**
   * Cutaway for a border considering holes
   * @param {RegionMovementWaypoint} start          Start of the segment
   * @param {RegionMovementWaypoint} end            End of the segment
   * @param {number} holeThreshold                  The hole threshold to use
   * @returns {PIXI.Polygon[]} The polygons for the cutaway (if any)
   */
  #cutawayPolygonsHoles(start, end, holeThreshold = 1) {
    const holePositions = this.holePositions(start, end, holeThreshold);
    if ( !holePositions.length ) return [];// return this.#cutawayPolygonsNoHoles(start, end);

    // Starting outside the tile and moving until we hit something.
    const polys = [];
    const bounds = this.alphaBorder;
    let a = holePositions[0];
    let onTile = !a.holeStart;
    for ( let i = 1, n = holePositions.length; i < n; i += 1 ) {
      const b = holePositions[i];
      if ( onTile && b.holeStart ) {
        const quad = this.#quadrangle2dCutaway(a, b, bounds, { start, end });
        if ( quad ) polys.push(quad);
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
   * Construct a quadrangle for a cutaway along a line segment
   * @param {RegionMovementWaypoint} a              Start of the segment
   * @param {RegionMovementWaypoint} b              End of the segment
   * @param {PIXI.Polygon|PIXI.Rectangle} shape     A polygon or rectangle from the tile
   * @param {object} [opts]                         Options that affect the shape
   * @param {RegionMovementWaypoint} [opts.start]   The start of the entire path, if different than a
   * @param {RegionMovementWaypoint} [opts.end]     The end of the entire path, if different than b
   * @param {boolean} [opts.isHole=false]           If true, reverse the polygon orientation
   * @returns {PIXI.Polygon|null}
   */
  #quadrangle2dCutaway(a, b, shape, { start, end, isHole = false } = {}) {
    if ( !shape.lineSegmentIntersects(a, b, { inside: true }) ) return null;

    // Build the polygon slightly larger than start and end so that the start and end will
    // be correctly characterized (float/ground/underground)
    start ??= a;
    end ??= b;
    let paddedStart = a;
    let paddedEnd = b;
    if ( start && regionWaypointsXYEqual(a, start) ) {
      paddedStart = PIXI.Point._tmp.copyFrom(start).towardsPoint(PIXI.Point._tmp2.copyFrom(end), -2);
      paddedStart.elevation = start.elevation;
    }
    if ( end && regionWaypointsXYEqual(b, end) ) {
      paddedEnd = PIXI.Point._tmp.copyFrom(end).towardsPoint(PIXI.Point._tmp2.copyFrom(start), -2);
      paddedEnd.elevation = end.elevation;
    }

    // Determine the appropriate endpoints.
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
    const TL = toCutawayCoord(a, start, end);
    const TR = toCutawayCoord(b, start, end);
    const BL = { x: TL.x, y: a.elevation - 1 };
    const BR = { x: TR.x, y: b.elevation - 1 };
    return isHole ? new PIXI.Polygon(TL, TR, BR, BL) : new PIXI.Polygon(TL, BL, BR, TR);
  }

  /**
   * Construct a pixel cache for the local values of the tile, in which every pixel
   * that is a hole (transparent alpha) has its value set to the smallest number of pixels
   * between the pixel and the next non-transparent pixel.
   * So if a pixel has value 3, then you can go 3 pixels in any direction before hitting a
   * non-transparent pixel.
   * @returns {PixelArray}
   */
  #constructHoleCache() {
    // First construct a pixel array where 0 = no alpha and 1 = alpha.
    // Then iterate through each pixel:
    // If 0, move to next
    // Check surrounding 8 pixels.
    // - Take lowest, ignoring pixels outside border. Add 1 and set pixel to this sum.
    // - If changed, flag because the 8 neighbors must be retested after iteration is finished.
    // Until no more changes: update the 8 neighbors of each changed pixel.
    const MAX_VALUE = 65535; // Uint16Array maximum.
    const { alphaThreshold, tile } = this;
    const tileCache = tile.evPixelCache;
    const holeCache = tileCache.constructor.fromOverheadTileAlpha(tile);
    const nPixels = tileCache.pixels.length;
    holeCache.pixels = new Uint16Array(nPixels);

    // Set each alpha pixel to the max integer value to start, 0 otherwise.
    console.group(`${MODULE_ID}|constructHoleCache`);
    const threshold = tileCache.maximumPixelValue * alphaThreshold;
    console.time(`${MODULE_ID}|Mark each alpha pixel`);
    for ( let i = 0; i < nPixels; i += 1 ) holeCache.pixels[i] = tileCache.pixels[i] > threshold ? 0 : MAX_VALUE;
    console.timeEnd(`${MODULE_ID}|Mark each alpha pixel`); // 6.5 ms.
    // avgPixels(holeCache.pixels); // 0.66
    // drawPixels(holeCache)
    // drawHoles(holeCache)
    // pixelCounts(holeCache, max = 1) // {0: 616231, 1: 0, > 1: 1408769, numPixels: 2025000}

    const changedIndices = new Set();
    const updatePixel = (cache, idx) => {
      const value = cache.pixels[idx];
      if ( !value ) return;
      const newValue = Math.min(MAX_VALUE, Math.min(...cache.localNeighbors(idx)) + 1);
      if ( value === newValue ) return;
      cache.pixels[idx] = newValue;
      changedIndices.add(idx);
    }

    // For each pixel that is greater than 0, its value is 1 + min of 8 neighbors.
    // Record changed indices so we can re-process those neighbors.

    console.time(`${MODULE_ID}|Iterate over every pixel`);
    for ( let i = 0; i < nPixels; i += 1 ) updatePixel(holeCache, i);
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
        const neighborIndices = holeCache.localNeighborIndices(idx);
        for ( const neighborIdx of neighborIndices ) updatePixel(holeCache, neighborIdx);
      }
    }
    console.timeEnd(`${MODULE_ID}|Update pixels`); // 28801.6630859375 ms // 11687.419189453125 ms using pixelStep instead of x,y.
    console.log(`${MODULE_ID}|${iter} iterations.`);
    console.groupEnd(`${MODULE_ID}|constructHoleCache`);
    return holeCache;
    // avgPixels(holeCache.pixels); // 1.33
    // drawPixels(holeCache)
    // drawHoles(holeCache)
    // pixelCounts(holeCache, max = 10)


    /* Debugging
    Draw = CONFIG.GeometryLib.Draw;
    sumPixels = pixels => pixels.reduce((acc, curr) => acc += curr);
    avgPixels = pixels => sumPixels(pixels) / pixels.length;

    function pixelCounts(cache, max = 1) {
      const countsArr = Array.fromRange(max + 1);
      const out = {};
      for ( const ct of countsArr ) {
        const fn = holeCache.constructor.pixelAggregator("count_eq_threshold", ct);
        out[ct] = fn(cache.pixels).count;
      }
      const gtFn = holeCache.constructor.pixelAggregator("count_gt_threshold", max);
      const gtRes = gtFn(cache.pixels);
      out[`> ${max}`] = gtRes.count;
      out.numPixels = gtRes.numPixels;
      return out;
    }

    function drawHoles(cache, {skip = 10, radius = 2 } = {}) {
      const { right, left, top, bottom } = cache.localFrame;
      const max = Math.max(cache.width, cache.height);
      for ( let x = left; x <= right; x += skip ) {
        for ( let y = top; y <= bottom; y += skip ) {
          const value = cache._pixelAtLocal(x, y);
          if ( value == null ) continue;
          const color = value > 0 ? Draw.COLORS.red : Draw.COLORS.white;
          Draw.point({x, y}, { color, alpha: 0.8, radius });
        }
      }
    }

    function drawPixel(cache, idx) {
      const value = cache.pixels[idx];
      if ( value == null ) {
        console.warn("Index out-of-bounds");
        return;
      }
      const pt = cache._localAtIndex(idx);
      const color = value > 0 ? Draw.COLORS.red : Draw.COLORS.white;
      Draw.point(pt, { color, radius: 1, alpha: 0.8 })
    }


    function drawPixels(cache, {skip = 10, radius = 2 } = {}) {
      const { right, left, top, bottom } = cache.localFrame;
      const max = Math.max(cache.width, cache.height);
      for ( let x = left; x <= right; x += skip ) {
        for ( let y = top; y <= bottom; y += skip ) {
          const value = cache._pixelAtLocal(x, y);
          if ( !value ) continue;

          let color = Draw.COLORS.black;
          if ( value === 1 ) color = Draw.COLORS.lightgreen;
          if ( value === 2 ) color = Draw.COLORS.lightorange;
          if ( value === 3 ) color = Draw.COLORS.lightred;
          if ( max * 0.001 > 3 && value > max * 0.001 ) color = Draw.COLORS.green;
          if ( max * 0.005 > 3 && value > max * 0.005 ) color = Draw.COLORS.orange;
          if ( max * 0.01 > 3 && value > max * 0.01 ) color = Draw.COLORS.red;
          if ( max * 0.05 > 3 && value > max * 0.05 ) color = Draw.COLORS.lightyellow;
          if ( max * 0.1 > 3 && value > max * 0.1 ) color = Draw.COLORS.yellow;
          if ( value > max * 0.15 ) color = Draw.COLORS.gray;
          if ( value > max * 0.2 ) color = Draw.COLORS.white;

          Draw.point({x, y}, { color, alpha: 0.8, radius });
        }
      }
    }
    */

  }
}
