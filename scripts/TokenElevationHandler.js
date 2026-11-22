/* globals
canvas,
CONFIG,
Hooks,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { GEOMETRY_LIB_ID } from "./geometry/const.js";
import { ElevatedPoint } from "./geometry/3d/ElevatedPoint.js";
import { gridUnitsToPixels, pixelsToGridUnits } from "./geometry/util.js";
import { Draw } from "./geometry/Draw.js";
import { AABB2d } from "./geometry/AABB.js";
import { TerrainGeometry } from "./GeometricPrimitives/TerrainGeometry.js";
import { fastFlag } from "./util.js";
import { CutawayPolygon } from "./geometry/CutawayPolygon.js";

/**
 * @typedef {object} Edge2d
 * @prop {PIXI.Point} a
 * @prop {PIXI.Point} b
 */

/**
 * Regions elevation handler
 * Class that handles movement across regions with plateaus or ramps.
 * Also handles elevated tile "floors".
 */
export class TokenElevationHandler {

  static ELEVATION_LOCATIONS = {
    OUTSIDE: 0,       // 0000 in binary
    BELOW: 2,         // 0010
    GROUND: 4,        // 0100
    ABOVE: 8,         // 1000

    // Synonyms
    BURROWING: 2,
    FLYING: 8,
    FLOATING: 8,
  };

  static VERTICAL_LOCATIONS = {
    NONE: 0,           // 000000
    LEFT: 16,          // 010000
    RIGHT: 32,         // 100000
  };

  static DOWN = new PIXI.Point(0, -1);

  static UP = new PIXI.Point(0, 1);

  /**
   * Tolerance, in pixels, for treating a point as lying on the start|end segment.
   * Core rounds token x,y to integers, so sub-pixel differences are rounding noise.
   * @type {number}
   */
  static PATH_TOLERANCE = 0.5;

  /**
   * Horizontal moves shorter than this (pixels) are treated as vertical-only moves.
   * Otherwise the direction of the cutaway plane would be set by rounding noise.
   * @type {number}
   */
  static MIN_HORIZONTAL_MOVE = 1;

  /**
   * Incremented whenever regions, tiles, levels, or scenes change.
   * Cutaways cached on a handler are stale if their version differs.
   * @type {number}
   */
  static terrainVersion = 0;

  /** Mark all cached cutaways (on every token's handler) as stale. */
  static invalidate() { this.terrainVersion += 1; }

  // ----- NOTE: Static methods ----- //

  /**
   * Retrieve all terrain regions. (Currently those representing plateaus, ramps, steps, or hills.)
   * @param {string} [levelId]  If provided, limit to regions seen from this level.
   *   Defaults to the current level (canvas.level.id).
   *   Use "" to include all regions.
   *
   * @returns {RegionDocument[]}
   */
  static terrainRegions(levelId = canvas.level.id) {
    return [...canvas.regions.documentCollection.values()].filter(regionD => {
      if ( !TerrainGeometry.isElevated(regionD) ) return false;
      if ( !levelId ) return true;
      return regionD.levels.has(levelId);
    });
  }

  /**
   * Retrieve all terrain regions. (Currently those representing plateaus, ramps, steps, or hills.)
   * @param {string} [levelId]  If provided, limit to regions seen from this level.
   *   Defaults to the current level (canvas.level.id).
   *   Use "" to include all regions.
   *
   * @type {TileDocument[]}
   */
  static terrainTiles(levelId = canvas.level.id) {
    return [...canvas.tiles.documentCollection.values()].filter(tileD => {
      if ( fastFlag(tileD, FLAGS.TILE.ALPHA_SHAPE) === FLAGS.TILE.ALPHA_SHAPE_OPTIONS.IGNORE ) return false;
      if ( !levelId ) return true;
      return tileD.levels.has(levelId);
    });
  }

  /**
   * Filter region by a 2d segment.
   * @param {(Region|RegionDocument)} region          Region to consider
   * @param {Point} start                             Start of the path
   * @param {Point} end                               End of the path
   * @returns {(Region|RegionDocument)} Region that may intersect the start|end segment.
   */
  static regionWithinXYSegment(region, start, end) {
    const geom = this.geometryForRegion(region);
    return geom.aabb.overlapsSegment(start, end, ["x", "y"]);
  }

  /**
   * Filter tile by a 2d segment.
   * @param {(Tile|TileDocument)[]} tile          Tile to consider
   * @param {Point} start                         Start of the path
   * @param {Point} end                           End of the path
   * @returns {(Tile|TileDocument)} Tile that may intersect the start|end segment
   */
  static tileWithinXYSegment(tile, start, end) {
    const geom = this.geometryForTile(tile);
    return geom.aabb.overlapsSegment(start, end, ["x", "y"]);
  }

  /**
   * Thickness, in pixels, of the slab used to represent a flat (zero-thickness) tile in a slice.
   * See QuadPrimitive#verticalSlice.
   * @type {number}
   */
  static TILE_THICKNESS = 1;

  /**
   * Retrieve the geometry for a region.
   * @param {Region|RegionDocument} region
   * @returns {TerrainGeometry|undefined}
   */
  static geometryForRegion(region) {
    const regionD = region.document || region;
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.regions.geomForDocument(regionD);
  }

  /**
   * Retrieve the geometry for a tile.
   * @param {Tile|TileDocument} tile
   * @returns {TileGeometry|undefined}
   */
  static geometryForTile(tile) {
    const tileD = tile.document || tile;
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.tiles.geomForDocument(tileD);
  }


  // ----- NOTE: Constructor ----- //

  token;

  regions = [];

  tiles = [];

  cutaways = [];

  constructor(token) {
    this.token = token;
  }

  /** @type {number} Value of TokenElevationHandler.terrainVersion when the cutaways were built. */
  terrainVersion = -1;

  /**
   * Signature of the path last built by Token#createTerrainMovementPath for this token.
   * Lets later calls (ruler refresh, commit of a dragged path) recognize and skip our own output.
   * @type {{ signature: object[], version: number }|null}
   */
  #builtSignature = null;

  /**
   * Remember the path just built.
   * @param {object[]} signature      From waypointSignature
   */
  rememberOutput(signature) {
    this.#builtSignature = { signature, version: this.constructor.terrainVersion };
  }

  /**
   * Is this set of waypoints the path last built for this token (or a prefix of it)?
   * A prefix occurs if core truncated the path, e.g., when constraining movement.
   * @param {object[]} signature      From waypointSignature
   * @returns {boolean}
   */
  isBuiltOutput(signature) {
    const built = this.#builtSignature;
    if ( !built || built.version !== this.constructor.terrainVersion ) return false;
    if ( signature.length < 2 || signature.length > built.signature.length ) return false;
    return signature.every((pt, i) => signaturePointsMatch(pt, built.signature[i]));
  }

  start = new PIXI.Point();

  end = new PIXI.Point();

  levelId = "";

  get floor() { return gridUnitsToPixels(this.constructor.floorForLevel(this.levelId || canvas.level.id)); }

  /**
   * Scene floor for the given level (not necessarily the viewed level).
   * @param {string} levelId
   * @returns {number} Elevation, in grid units, of the floor.
   */
  static floorForLevel(levelId) {
    const level = canvas.scene.levels.get(levelId) ?? canvas.level;
    return level.elevation.base;
  }

  to2d(pt3d) { return CutawayPolygon.to2d(pt3d, this.start, this.end); }

  from2d(cutawayPt) { return CutawayPolygon.from2d(cutawayPt, this.start, this.end); }

  /**
   * Add spacer to the start and end to ensure that cutaway polygons extend beyond the desired
   * start/end point.
   * This avoids issues where the path artificially moves down or up b/c it is at the cutoff.
   * This sets the start and end properties.
   * @param {PIXI.Point} start
   * @param {PIXI.Point} end
   */
  _setStartAndEnd(start, end) {
    using startXY = PIXI.Point.fromObject(start);
    using endXY = PIXI.Point.fromObject(end);
    if ( startXY.equals(endXY) ) startXY.x += 1;  // Arbitrarily extend so there is a cutaway x/y surface.
    const distXY = PIXI.Point.distanceBetween(startXY, endXY);
    startXY.towardsPoint(endXY, distXY + 1, this.end);
    endXY.towardsPoint(startXY, distXY + 1, this.start);
    this.start.z = start.z ?? (start.elevation ? gridUnitsToPixels(start.elevation) : 0);
    this.end.z = end.z ?? (end.elevation ? gridUnitsToPixels(end.elevation) : 0);
    this.start.roundDecimals(1);
    this.end.roundDecimals(1);
  }

  _initialize(start, end, levelId = canvas.level.id) {
    this.start.copyFrom(start);
    this.end.copyFrom(end);
    this._setStartAndEnd(start, end);

    this.levelId = levelId;
    this.terrainVersion = this.constructor.terrainVersion;
    this.cutaways.length = 0;

    // Find regions within the start|end path.
    this.regions = this.constructor.terrainRegions(levelId).filter(region =>
      this.constructor.regionWithinXYSegment(region, start, end));
    this.tiles = this.constructor.terrainTiles(levelId).filter(tile =>
      this.constructor.tileWithinXYSegment(tile, start, end));

    // Slice each region and tile with the vertical plane through the start|end path.
    // Slices are in cutaway space:
    //   - x is linear distance from start
    //   - y is elevation in pixels
    for ( const region of this.regions ) {
      const geom = this.constructor.geometryForRegion(region);
      const elevs = geom.elevationZ;
      this.cutaways.push(...geom.verticalSlice(this.start, this.end, elevs));
    }

    for ( const tile of this.tiles ) {
      const geom = this.constructor.geometryForTile(tile);
      const elevs = geom.elevationZ;
      const geomSubtype = fastFlag(geom.placeableDocument, FLAGS.TILE.ALPHA_SHAPE)
        || FLAGS.TILE.ALPHA_SHAPE_OPTIONS.CALCULATED;
      this.cutaways.push(...geom[geomSubtype].verticalSlice(this.start, this.end, elevs));
    }

    // Transition the cutaways to linear distance, not distance-squared.
    this.cutaways = this.cutaways.map(cutaway => new CutawayHandler(cutaway));
  }


  // ----- NOTE: Movement mode ----- //

  get walking() { return this.constructor.tokenIsWalking(this.token); }

  get burrowing() { return this.constructor.tokenIsBurrowing(this.token); }

  get flying() { return this.constructor.tokenIsFlying(this.token); }

  /**
   * Resolve movement flags (defaulting to the token's current action) to a single mode.
   * @param {object} [flags]
   * @param {boolean} [flags.walking]
   * @param {boolean} [flags.burrowing]
   * @param {boolean} [flags.flying]
   * @returns {"walking"|"burrowing"|"flying"|null}   Null if the token is not bound by terrain.
   */
  _movementMode({ walking, burrowing, flying } = {}) {
    walking ??= this.walking;
    burrowing ??= this.burrowing;
    flying ??= this.flying;
    if ( flying && burrowing ) return null; // Can fly and burrow; terrain does not matter.
    if ( burrowing ) return "burrowing";
    if ( flying ) return "flying";
    if ( walking ) return "walking";
    return null;
  }

  // ----- NOTE: Elevation at a position ----- //

  /*
    Every x/y position has a ground elevation, determined only by the cutaway ranges at that x and the token's
    elevation z (to ignore terrain floating above the token). The movement mode then picks the permitted elevation:
      walking:   exactly the ground
      burrowing: at or below the ground
      flying:    at or above the ground
    Because the rule depends only on the position (and z), the elevation is the same whichever direction the
    token approaches from. At a vertical edge, the ground is the top of the edge, so moving in and out is symmetric.
  */

  // BEGIN-PROFILE
  /**
   * Slack, in pixels of elevation, when testing whether a token is at or above the bottom of a terrain.
   * @type {number}
   */
  static ELEVATION_TOLERANCE = 0.1;

  /**
   * Permitted elevation given the ground.
   * @param {"walking"|"burrowing"|"flying"} mode
   * @param {number} z          Desired elevation
   * @param {number} ground     Ground elevation at the position
   * @returns {number}
   */
  static constrainElevation(mode, z, ground) {
    switch ( mode ) {
      case "burrowing": return Math.min(z, ground);
      case "flying": return Math.max(z, ground);
      default: return ground;
    }
  }

  /**
   * Get the elevation ranges for all cutaways at x.
   * @param {number} x
   * @param {-1|0|1} [side=0]     -1: limit approaching x from the left; 1: from the right;
   *                              0: both sides together (a vertical edge covers its full height)
   * @returns {number[2][]}
   */
  _cutawayElevationRangesAtX(x, side = 0) {
    const ranges = [];
    for ( const cutaway of this.cutaways ) {
      const r = cutaway.rangeAt(x, side);
      if ( r ) ranges.push(r);
    }
    return ranges;
  }

  /** @type {number} Cached ground value for token */
  #ground = null;

  get ground() { return this.groundAt(); } // Once hooks are set: return (this.#ground ??= this.groundAt()); }

  clearGroundCache() { this.#ground = null; } // TODO: Set up hooks to clear.

  /**
   * Ground elevation of the current token at a given location.
   * @param {Point3d} pt          Point to use for the location; may have elevation property
   * @returns {number} Elevation in grid units
   */
  groundAt(pt) {
    using loc = pt ? ElevatedPoint.fromObject(pt) : ElevatedPoint.fromToken(this.token).bottom;
    const handler = new TokenElevationHandler(this.token);
    handler._initialize(loc, loc);
    using loc2d = handler.to2d(loc);
    const ground = handler._groundAt(loc2d.x, loc2d.y, 0);
    return pixelsToGridUnits(ground);
  }


  /**
   * Ground elevation at x for a token at elevation z: the highest top of the (merged) ranges
   * whose bottom is at or below z, or the scene floor. Terrain floating above z is ignored.
   * At a vertical edge (side 0) this is the top of the edge.
   * @param {number} x            X value along the cutaway path.
   * @param {number} z
   * @param {-1|0|1} [side=0]
   * @returns {number}
   */
  _groundAt(x, z, side = 0) {
    let ground = this.floor;
    const tolerance = this.constructor.ELEVATION_TOLERANCE;
    for ( const [low, high] of mergeRanges(this._cutawayElevationRangesAtX(x, side)) ) {
      if ( low <= z + tolerance && high > ground ) ground = high;
    }
    return ground;
  }

  /**
   * Where do the tops of two overlapping cutaways cross between breakpoints?
   * Between breakpoints every top is linear, but the highest of several linear tops is not.
   * @param {number[]} breaks     Sorted
   * @returns {number[]}
   */
  _topCrossings(breaks) {
    const crossings = [];
    for ( let i = 0, n = breaks.length - 1; i < n; i += 1 ) {
      const x0 = breaks[i];
      const x1 = breaks[i + 1];
      const tops = [];
      for ( const cutaway of this.cutaways ) {
        const t0 = cutaway.topAt(x0, 1);
        const t1 = cutaway.topAt(x1, -1);
        if ( t0 !== null && t1 !== null ) tops.push([t0, t1]);
      }
      for ( let j = 0; j < tops.length; j += 1 ) {
        for ( let k = j + 1; k < tops.length; k += 1 ) {
          const d0 = tops[j][0] - tops[k][0];
          const d1 = tops[j][1] - tops[k][1];
          if ( d0 * d1 < 0 ) crossings.push(x0 + ((x1 - x0) * (d0 / (d0 - d1))));
        }
      }
    }
    return crossings;
  }

  /**
   * Build the elevation profile from a2d to b2d, in cutaway space (x is distance, y is elevation).
   * 1. Breakpoints: every cutaway vertex (and crossing of two tops) between a and b.
   * 2. At each breakpoint, evaluate the permitted elevation just before and just after.
   *    A difference is a vertical step at that x. Linear in between.
   * 3. Walking follows the ground. Flying and burrowing follow the straight line from a to b,
   *    constrained by the ground (so a flier rejoins its line after clearing terrain).
   * The first point is the start itself; the position of the start and end use the top of any vertical edge.
   * @param {"walking"|"burrowing"|"flying"} mode
   * @param {PIXI.Point} a2d
   * @param {PIXI.Point} b2d
   * @returns {PIXI.Point[]}
   */
  _profilePath2d(mode, a2d, b2d) {
    const EPS = 1e-6;
    const constrain = this.constructor.constrainElevation;
    const xa = a2d.x;
    const xb = b2d.x;
    const span = xb - xa;
    const free = mode !== "walking";
    const line = x => ((Math.abs(span) > EPS) ? a2d.y + ((b2d.y - a2d.y) * ((x - xa) / span)) : a2d.y);

    // The cutaway plane is oriented by the move that initialized it; later moves along the same line may go
    // either way. dir = +1: toward higher cutaway x; -1: toward lower. Everything below is in travel order.
    const dir = (xb >= xa) ? 1 : -1;
    const xMin = Math.min(xa, xb);
    const xMax = Math.max(xa, xb);
    const arrive = -dir; // Side from which the token arrives at a breakpoint: the side it came from.
    const leave = dir;   // Side toward which the token leaves.

    // Terrain along this segment; otherwise nothing to do.
    const relevant = this.cutaways.filter(h => h.aabb.max.x >= xMin - EPS && h.aabb.min.x <= xMax + EPS);
    if ( !relevant.length ) return [new PIXI.Point(xa, a2d.y), new PIXI.Point(xb, b2d.y)];

    // Breakpoints, ascending in x.
    const dedupe = xs => xs.sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > EPS);
    let breaks = [xMin, xMax];
    for ( const h of relevant ) {
      for ( const x of h.breakpoints() ) if ( x > xMin + EPS && x < xMax - EPS ) breaks.push(x);
    }
    breaks = dedupe(breaks);
    const crossings = this._topCrossings(breaks);
    if ( crossings.length ) breaks = dedupe([...breaks, ...crossings]);
    if ( dir < 0 ) breaks.reverse(); // Now in travel order; breaks[0] is xa.

    // Sweep.
    const path = [new PIXI.Point(xa, a2d.y)];
    const push = (x, y) => {
      const last = path.at(-1);
      if ( Math.abs(last.x - x) < EPS && Math.abs(last.y - y) < EPS ) return;
      path.push(new PIXI.Point(x, y));
    };
    let z = a2d.y; // Walking carries the elevation, so terrain floating above is ignored.
    const lastIdx = breaks.length - 1;
    for ( let i = 0; i <= lastIdx; i += 1 ) {
      const x = breaks[i];
      const zRef = z => (free ? line(x) : z);

      if ( i === 0 ) {
        z = constrain(mode, zRef(z), this._groundAt(x, zRef(z), 0)); // The position of the start.
        push(x, z);
      } else {
        z = constrain(mode, zRef(z), this._groundAt(x, zRef(z), arrive));
        push(x, z);
        if ( i === lastIdx ) {
          z = constrain(mode, zRef(z), this._groundAt(x, zRef(z), 0)); // The position of the end.
          push(x, z);
        }
      }
      if ( i === lastIdx ) break;

      z = constrain(mode, zRef(z), this._groundAt(x, zRef(z), leave));
      push(x, z);

      // Flying and burrowing: the line may cross the ground within the interval.
      if ( free ) {
        const xNext = breaks[i + 1];
        const d0 = line(x) - this._groundAt(x, line(x), leave);
        const d1 = line(xNext) - this._groundAt(xNext, line(xNext), arrive);
        if ( (d0 > EPS && d1 < -EPS) || (d0 < -EPS && d1 > EPS) ) {
          const xc = x + ((xNext - x) * (d0 / (d0 - d1)));
          push(xc, line(xc));
        }
      }
    }
    return path;
  }
  // END-PROFILE

  /**
   * Enforce gravity for this token. Move the token from its current position to the permitted elevation.
   * Typically done after a level or scene change.
   * Walking: on the ground. Burrowing: at or below the ground. Flying: at or above the ground.
   * @param {ElevatedPoint} currentLocation
   * @param {object} [opts]
   * @param {string} [opts.levelId]     Level at the destination
   * @param {boolean} [opts.walking]    Movement flags from the waypoint action. Default to the token's HUD action.
   * @param {boolean} [opts.burrowing]
   * @param {boolean} [opts.flying]
   * @param {boolean} [opts.initialize=true]    If false, presume the handler is initialized for this point.
   * @returns {ElevatedPoint} Destination point
   */
  enforceGravity(currentLocation, { levelId, walking, burrowing, flying, initialize = true } = {}) {
    const tokenD = this.token.document;
    currentLocation ??= ElevatedPoint.fromLocationWithElevation(tokenD.getCenterPoint(), tokenD.bottomZ);
    const mode = this._movementMode({ walking, burrowing, flying });
    if ( !mode ) return currentLocation;
    if ( initialize ) this._initialize(currentLocation, currentLocation, levelId);

    using curr2d = this.to2d(currentLocation);
    const y = this.constructor.constrainElevation(mode, curr2d.y, this._groundAt(curr2d.x, curr2d.y, 0));
    if ( Math.abs(y - curr2d.y) < 0.05 ) return currentLocation;
    curr2d.y = y;
    return this.from2d(curr2d);
  }

  /**
   * Deduplicate path points.
   * @param {ElevatedPoint[]} path
   * @returns {ElevatedPoint[]} Same path, with consecutive duplicates removed.
   */
  deduplicatePath(path) {
    if ( path.length < 2 ) return path;
    let last = path[0];
    const out = [last];
    for ( let i = 1; i < path.length; i += 1 ) {
      const curr = path[i];
      if ( last.almostEqual(curr) ) continue;
      out.push(curr);
      last = curr;
    }
    return out;
  }

  /** Mode-specific entry points kept for callers of the previous API. */
  constructWalkingPath(a, b, opts = {}) {
    return this.constructPath(a, b, { ...opts, walking: true, flying: false, burrowing: false });
  }

  constructBurrowingPath(a, b, opts = {}) {
    return this.constructPath(a, b, { ...opts, walking: false, flying: false, burrowing: true });
  }

  constructFlyingPath(a, b, opts = {}) {
    return this.constructPath(a, b, { ...opts, walking: false, flying: true, burrowing: false });
  }

  /**
   * Determine the path between a and b that accounts for terrain regions and terrain tiles
   * along the way. The first point of the returned path is always a.
   * Points a and b should be on the start|end segment; otherwise this will be reinitialized.
   * @param {ElevatedPoint} a
   * @param {ElevatedPoint} b
   * @param {object} [opts]
   * @param {boolean} [opts.flying]
   * @param {boolean} [opts.burrowing]
   * @param {boolean} [opts.walking]
   * @param {string} [opts.levelId]     Level to use for regions and tiles. Defaults to the viewed level.
   * @param {boolean} [opts.initialize=true]    If false, presume the handler is already initialized for a|b.
   * @returns {ElevatedPoint[]}
   */
  constructPath(a, b, { flying, burrowing, walking, levelId, initialize = true } = {}) {
    a.roundDecimals(1);
    b.roundDecimals(1);
    if ( a.equals(b) ) return [a.clone()];

    const mode = this._movementMode({ flying, burrowing, walking });
    levelId ??= canvas.level.id;

    // Token unbound by terrain.
    if ( !mode ) return [a.clone(), b.clone()];

    // Vertical-only move. Core rounds x,y to integers, so treat sub-pixel xy differences as no horizontal
    // movement; otherwise the direction of the cutaway plane is set by rounding noise.
    if ( Math.hypot(b.x - a.x, b.y - a.y) < this.constructor.MIN_HORIZONTAL_MOVE ) {
      return this.verticalOnlyMove(a, b.z, { flying, walking, burrowing, levelId, initialize: true });
    }

    // Initialize only if needed.
    if ( initialize && this._initializationRequired(a, b, levelId) ) this._initialize(a, b, levelId);

    // If no cutaways, allow free movement.
    if ( !this.cutaways.length ) return [a.clone(), b.clone()];

    using a2d = this.to2d(a);
    using b2d = this.to2d(b);
    let path2d;
    try {
      path2d = this._profilePath2d(mode, a2d, b2d);
      this.#verifyPath2d(path2d);
    } catch( err ) {
      console.error(`constructPath ${mode} ${a} -> ${b}`, path2d);
      console.error(err);
      return [a.clone(), b.clone()];
    }

    // Back to 3d. The first point is a itself.
    const out = [a.clone()];
    for ( const pt2d of path2d ) {
      const pt = this.from2d(pt2d).roundDecimals(1);
      const prev = out.at(-1);
      if ( Math.abs(pt.x - prev.x) < 0.05
        && Math.abs(pt.y - prev.y) < 0.05
        && Math.abs(pt.z - prev.z) < 0.05 ) continue;
      out.push(pt);
    }
    if ( out.length < 2 ) out.push(b.clone());
    return this.deduplicatePath(out);
  }

  /**
   * Do we need to reinitialize the regions and tiles prior to calculating this path?
   * Yes if the level changed, terrain changed, or points a and b are not both on the
   * start|end segment (within a pixel-scale tolerance).
   * @param {ElevatedPoint} a
   * @param {ElevatedPoint} b
   * @param {string} levelId
   * @returns {boolean} True if initialization is required.
   */
  _initializationRequired(a, b, levelId = canvas.level.id) {
    if ( levelId !== this.levelId ) return true;
    if ( this.terrainVersion !== this.constructor.terrainVersion ) return true;

    const { start, end } = this;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if ( len < 1e-6 ) return true;

    // Both points must lie on the segment: distance from the line within tolerance, and
    // projection onto the line within the segment (the segment is already padded by 1 pixel at each end).
    const tol = this.constructor.PATH_TOLERANCE;
    for ( const pt of [a, b] ) {
      const px = pt.x - start.x;
      const py = pt.y - start.y;
      const perp = Math.abs((dx * py) - (dy * px)) / len;
      const along = ((px * dx) + (py * dy)) / len;
      if ( perp > tol || along < -tol || along > len + tol ) return true;
    }
    return false;
  }

  #verifyPath2d(path2d) {
    if ( !path2d.length ) throw Error("Path is empty.");
    if ( path2d.length > 9999 ) throw Error("Path is too long.");
    if ( path2d.some(pt => isNaN(pt.x) || isNaN(pt.y)) ) throw Error("Path has NaN.");
    if ( path2d.some(pt => pt.y > 100000 || pt.y < -100000) ) throw Error("Path elevation error");
  }

  /**
   * Move from current location to a new z value at the same XY location.
   * @param {ElevatedPoint} a
   * @param {number} desiredElevation
   * @param {object} [opts]
   * @param {boolean} [opts.flying]           Defaults to the current token state
   * @param {boolean} [opts.burrowing]        Defaults to the current token state
   * @param {boolean} [opts.walking]          Defaults to the current token state
   * @param {string} [opts.levelId]           Defaults to the current canvas level
   * @param {boolean} [opts.initialize = true]
   * @returns {ElevatedPoint[]} One or more points. Single point if no move is required.
   */
  verticalOnlyMove(a, desiredElevation, { flying, burrowing, walking, levelId, initialize = true } = {}) {
    a.roundDecimals(1);
    if ( Math.abs(a.z - desiredElevation) < 0.05 ) return [a.clone()];

    const free = () => [a, ElevatedPoint.tmp.set(a.x, a.y, desiredElevation)];
    const mode = this._movementMode({ flying, burrowing, walking });
    if ( !mode ) return free();
    if ( initialize ) this._initialize(a, a, levelId);

    // If no cutaways at this location, allow free movement.
    using a2d = this.to2d(a);
    if ( !this.cutaways.some(handler => handler.aabb.containsPoint(a2d, ["x"])) ) return free();

    // Walking: cannot choose the elevation; gravity. Flying: not below the ground. Burrowing: not above it.
    const ground = this._groundAt(a2d.x, a2d.y, 0);
    const y = mode === "walking" ? ground : this.constructor.constrainElevation(mode, desiredElevation, ground);
    if ( Math.abs(y - a.z) < 0.05 ) return [a.clone()];
    a2d.y = y;
    return [a, this.from2d(a2d)];
  }

  // ----- NOTE: Token actions ----- //

  /**
   * Determine if a token is taking a flight action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsWalking(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainWalkActions.has(action);
  }

  /**
   * Determine if a token is taking a flight action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsFlying(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainFlightActions.has(action);
  }

  /**
   * Determine if a token is taking a burrowing action.
   * @param {Token} token                     Token doing the movement
   * @returns {boolean} True if token has flying status.
   */
  static tokenIsBurrowing(token) {
    const action = token._getHUDMovementAction();
    return CONFIG[MODULE_ID].terrainBurrowActions.has(action);
  }

  // ----- NOTE: Debugging ----- //

  static drawPath(path, drawOpts) {
    Draw.connectPoints(path);
    path.forEach(pt => Draw.point(pt, drawOpts));

    // Draw 2d.
    const start = path.at(0);
    const dist = PIXI.Point.distanceBetween(start, path.at(-1));
    path.forEach(pt => {
      const ptDist = PIXI.Point.distanceBetween(start, pt);
      const t = ptDist / dist;
      pt.t0 = t;
    });
    const cutawayPath = path.map(pt => new PIXI.Point(pt.t0 * 1000, -pt.z));
    for ( let i = 1; i < cutawayPath.length; i += 1 ) Draw.segment({
      a: cutawayPath[i - 1],
      b: cutawayPath[i]
    }, drawOpts);
    cutawayPath.forEach(pt => Draw.point(pt, drawOpts));
  }
}

/**
 * Top and bottom surface profiles of a cutaway polygon (x is distance along the path; y is elevation).
 * Lookups can be one-sided so that a vertical edge is well defined:
 *   side -1: the limit approaching x from the left
 *   side +1: the limit leaving x to the right
 *   side  0: both sides; the top is the higher of the two and the bottom the lower
 *            (at a vertical edge, the top of the edge)
 */
export class CutawayHandler {

  /** Tolerance in x (pixels) for treating a position as at a vertex. */
  static EPS = 1e-6;

  /** @type {CutawayPolygon} */
  cutPoly;

  /** @type {AABB2d} */
  aabb;

  constructor(cutPoly) {
    this.cutPoly = cutPoly;
    this.aabb = AABB2d.fromPolygon(cutPoly);
    this.#buildProfile();
  }

  /**
   * Non-vertical edges of the top (walkable) surface, each stored left-to-right, sorted by x.
   * @type {{a: PIXI.Point, b: PIXI.Point}[]}
   */
  #topEdges;

  /**
   * Non-vertical edges of the bottom (underside) surface, each stored left-to-right, sorted by x.
   * @type {{a: PIXI.Point, b: PIXI.Point}[]}
   */
  #bottomEdges;

  #buildProfile() {
    const tops = [];
    const bottoms = [];
    const positive = this.cutPoly.isPositive;
    for ( const edge of this.cutPoly.iterateEdges() ) {
      if ( edge.a.x.almostEqual(edge.b.x) ) continue; // Vertical side.
      // Positive winding: top edges run high x --> low x; bottom edges low x --> high x. Reverse for negative.
      const leftToRight = edge.a.x < edge.b.x;
      const isTop = positive ? !leftToRight : leftToRight;
      const normalized = leftToRight ? edge : edge.reverse();
      (isTop ? tops : bottoms).push(normalized);
    }
    tops.sort((e1, e2) => e1.a.x - e2.a.x);
    bottoms.sort((e1, e2) => e1.a.x - e2.a.x);
    this.#topEdges = tops;
    this.#bottomEdges = bottoms;
  }

  /**
   * Elevation of the top surface at x.
   * @param {number} x
   * @param {-1|0|1} [side=0]
   * @returns {number|null} Null if the top surface does not cover x on that side.
   */
  topAt(x, side = 0) { return CutawayHandler.#elevationAt(this.#topEdges, x, side, Math.max); }

  /**
   * Elevation of the bottom surface at x.
   * @param {number} x
   * @param {-1|0|1} [side=0]
   * @returns {number|null} Null if the bottom surface does not cover x on that side.
   */
  bottomAt(x, side = 0) { return CutawayHandler.#elevationAt(this.#bottomEdges, x, side, Math.min); }

  /**
   * Elevation range at x.
   * @param {number} x
   * @param {-1|0|1} [side=0]
   * @returns {number[2]|null} Array of bottom and top elevations or null.
   */
  rangeAt(x, side = 0) {
    const t = this.topAt(x, side);
    if ( t === null ) return null;
    const b = this.bottomAt(x, side);
    if ( b === null ) return null;
    return [b, t];
  }

  // ----- NOTE: Compatibility helpers ----- //

  segmentInBounds(a2d, b2d, axes) { return this.aabb.overlapsSegment(a2d, b2d, axes); }

  pointInBounds(a2d, axes) { return this.aabb.containsPoint(a2d, axes); }

  /** Terrain version of `region.document.testPoint`. Rejects if above or below the cutaway. */
  testPoint(pt2d) {
    if ( !this.pointInBounds(pt2d) ) return false;
    return this.cutPoly.contains(pt2d.x, pt2d.y);
  }

  segmentIntersections(a2d, b2d, opts) { return this.cutPoly.segmentIntersections(a2d, b2d, opts); }

  /** Alias of breakpoints(). */
  topBreakpoints() { return this.breakpoints(); }

  /**
   * The x-values of every vertex of the top and bottom surfaces, where the slope or coverage can change.
   * @returns {number[]}
   */
  breakpoints() {
    const xs = [];
    for ( const e of this.#topEdges ) xs.push(e.a.x, e.b.x);
    for ( const e of this.#bottomEdges ) xs.push(e.a.x, e.b.x);
    return xs;
  }

  static #elevationAt(edges, x, side, pick) {
    if ( side ) return CutawayHandler.#edgeElevation(edges, x, side);
    const left = CutawayHandler.#edgeElevation(edges, x, -1);
    const right = CutawayHandler.#edgeElevation(edges, x, 1);
    if ( left === null ) return right;
    if ( right === null ) return left;
    return pick(left, right);
  }

  /**
   * One-sided lookup. The edges partition x into (left, right] for side -1 and [left, right) for side 1.
   */
  static #edgeElevation(edges, x, side) {
    const eps = CutawayHandler.EPS;
    for ( const e of edges ) {
      const l = e.a.x;
      const r = e.b.x;
      if ( l > x + eps ) break; // Sorted by left x.
      const covers = side < 0 ? (x > l + eps && x <= r + eps) : (x >= l - eps && x < r - eps);
      if ( !covers ) continue;
      return e.a.y + ((e.b.y - e.a.y) * ((Math.min(Math.max(x, l), r) - l) / (r - l)));
    }
    return null;
  }
}


// ----- NOTE: Helper functions ----- //

/**
 * Merge ranges that overlap. E.g., [[10, 20], [15, 30]] returns [[10, 30]].
 * @param {number[2][]} ranges
 * @returns {number[2][]}
 */
function mergeRanges(ranges) {
  if ( ranges.length < 2 ) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged = [[sorted[0][0], sorted[0][1]]];
  for ( let i = 1; i < sorted.length; i++ ) {
    const current = sorted[i];
    const lastMerged = merged.at(-1);
    if ( current[0] <= lastMerged[1] ) lastMerged[1] = Math.max(lastMerged[1], current[1]);
    else merged.push([current[0], current[1]]);
  }
  return merged;
}


// ----- NOTE: Waypoint signatures and validation (used by Token#createTerrainMovementPath) ----- //

// BEGIN-WAYPOINT-UTILS
/**
 * Compact signature of waypoints, at the precision core stores them: integer x,y; elevation to 0.1.
 * Expects waypoints already normalized (all properties filled in).
 * @param {object[]} waypoints
 * @returns {{x: number, y: number, e: number, level: string, action: string}[]}
 */
export function waypointSignature(waypoints) {
  return waypoints.map(pt => ({
    x: Math.round(pt.x),
    y: Math.round(pt.y),
    e: Math.round(pt.elevation * 10) / 10,
    level: pt.level,
    action: pt.action }));
}

/**
 * Do two signature entries describe the same waypoint? An undefined action is a wildcard.
 */
function signaturePointsMatch(p, q) {
  return p.x === q.x
    && p.y === q.y
    && Math.abs(p.e - q.e) < 0.05
    && p.level === q.level
    && (p.action === undefined || q.action === undefined || p.action === q.action);
}

/**
 * Validate a built path of waypoints (token top-left x,y in pixels; elevation in grid units).
 * With start and end, also validates the path as a single straight segment from start to end:
 * the path must begin at start, finish at end's x,y, stay on the line, and never double back.
 * Without them, only the general checks run (use for the full multi-segment path).
 *
 * @param {object[]} path
 * @param {object} [opts]
 * @param {object} [opts.start]       Segment start waypoint
 * @param {object} [opts.end]         Segment end waypoint
 * @param {number} [opts.maxPoints=1000]
 * @param {number} [opts.tolerance=1.5]   Pixels of slack for rounding to integers and token centering
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateWaypointPath(path, { start, end, maxPoints = 1000, tolerance = 1.5 } = {}) {
  const errors = [];
  if ( !Array.isArray(path) || path.length < 2 ) return { valid: false, errors: ["fewer than 2 points"] };
  if ( path.length > maxPoints ) errors.push(`too many points (${path.length})`);

  // Non-finite values make every later test meaningless.
  for ( let i = 0; i < path.length; i += 1 ) {
    const pt = path[i];
    if ( !(Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.elevation)) ) {
      errors.push(`non-finite value at point ${i}`);
    }
  }
  if ( errors.length ) return { valid: false, errors };

  // No consecutive duplicates.
  for ( let i = 1; i < path.length; i += 1 ) {
    const p = path[i - 1];
    const q = path[i];
    // Waypoints on different levels are not duplicates.
    if ( p.x === q.x && p.y === q.y && p.level === q.level && Math.abs(p.elevation - q.elevation) < 0.05 ) {
      errors.push(`duplicate points at ${i - 1},${i}`);
    }
  }

  if ( start && end ) {
    // Endpoints
    const first = path[0];
    const last = path.at(-1);
    if ( Math.abs(first.x - start.x) > tolerance || Math.abs(first.y - start.y) > tolerance ) errors.push("does not begin at start");
    if ( Math.abs(last.x - end.x) > tolerance || Math.abs(last.y - end.y) > tolerance ) errors.push("does not finish at end");

    // Every point on the start|end line, within the segment, and never moving backwards.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if ( len > tolerance ) {
      let prevAlong = Number.NEGATIVE_INFINITY;
      for ( let i = 0; i < path.length; i += 1 ) {
        const px = path[i].x - start.x;
        const py = path[i].y - start.y;
        const perp = Math.abs((dx * py) - (dy * px)) / len;
        const along = ((px * dx) + (py * dy)) / len;
        if ( perp > tolerance ) errors.push(`point ${i} is ${perp.toFixed(1)}px off the line`);
        if ( along < -tolerance || along > len + tolerance ) errors.push(`point ${i} is outside the segment`);
        if ( along < prevAlong - tolerance ) errors.push(`point ${i} doubles back`);
        prevAlong = Math.max(prevAlong, along);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
// END-WAYPOINT-UTILS


// ----- NOTE: Hooks ----- //

// Cutaways cached on each token's handler are stale if the terrain they were sliced from changes.
for ( const documentName of ["Region", "RegionBehavior", "Tile", "Level", "Scene"] ) {
  for ( const event of ["create", "update", "delete"] ) {
    Hooks.on(`${event}${documentName}`, () => TokenElevationHandler.invalidate());
  }
}

Hooks.on("canvasReady", () => TokenElevationHandler.invalidate());
