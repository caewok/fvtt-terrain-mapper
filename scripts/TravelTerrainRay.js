/* globals
canvas,
CONFIG,
foundry,
game,
mergeObject,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { TerrainKey } from "./TerrainPixelCache.js";

/* Testing
  tm = canvas.terrain;
  ev = canvas.elevation;
  Point3d = CONFIG.GeometryLib.threeD.Point3d

  origin = new Point3d();
  destination = new Point3d();

  token = canvas.tokens.controlled[0];
  destination.copyFrom(game.user.targets.values().next().value.center);

  origin.copyFrom(token.center);
  origin.z = token.elevationZ;

  ter = new ev.TravelElevationRay(this.token, { origin, destination });
  evPath = ter._walkPath();

  markTerrainFn = (curr, prev) => curr !== prev;
  terrainChanges = tm.pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(origin, destination, markTerrainFn)

  ttr = new tm.TravelTerrainRay(token, { destination })
  ttr._walkPath()

*/

/**
 * Determine the terrain(s) applicable to the token traveling along a 3d ray.
 * If EV is present, use the TravelElevationRay to set elevation if automating elevation change.
 * Returns the points, from t0 to t1, on which there is a terrain change.
 * Each point describes the terrains applicable from that point to the next.
 */

export class TravelTerrainRay {
  /** @type {Token} */
  #token;

  /** @type {PIXI.Point} */
  #destination = new Point3d();

  /** @type {PIXI.Point} */
  #origin = new Point3d();

  /** @type {object[]} */
  #path = [];

  /** @type {function} */
  #markTerrainFn = (curr, prev) => curr !== prev;

  /** @type {Map<number, Marker>} */
  _markerMap = new Map();

  /**
   * @param {Token} token               Token that is undertaking the movement
   * @param {PIXI.Point} destination    {x,y} destination for the movement
   * @param {Point} [opts.tokenCenter]      Assumed token center at start
   * @param {number} [opts.tokenElevation]  Assumed token elevation at start
   */
  constructor(token, { origin, destination } = {}) {
    this.#token = token;
    if ( origin ) this.origin.copyFrom(origin);
    else {
      this.origin.copyFrom(token.center);
      this.origin.z = token.elevationZ;
    }
    if ( destination ) this.destination.copyFrom(destination);
  }

  /**
   * Retrieve all terrain levels for a given pixel key.
   * @param {TerrainKey} key
   * @returns {TerrainLevels[]}
   */
  static terrainLevelsForKey(key) { return canvas.terrain._layersToTerrainLevels(key.toTerrainLayers()); }

  /** @type {Point3d} */
  get origin() { return this.#origin; }

  set origin(value) {
    this.#origin.copyFrom(value);
    this.#path.length = 0;
  }

  /** @type {Point3d} */
  get destination() { return this.#destination; }

  set destination(value) {
    this.#destination.copyFrom(value);
    this.#path.length = 0;
  }

  get path() {
    if ( !this.#path.length ) this._walkPath();
    return this.#path;
  }

  /**
   * @param {number} t      Percent distance along origin --> destination ray in 2d.
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.origin.to2d().projectToward(this.destination.to2d(), t); }

  /**
   * All unique terrains encountered at this point along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {Set<Terrain>} Terrains at that location.
   */
  terrainsAtT(t) {
    const mark = this._pathMarkerAtT(t);
    if ( !mark ) return [];

    const terrainLevels = this.constructor.terrainLevelsForKey(mark.terrainKey);
    return new Set(terrainLevels.map(t => t.terrain));
  }

  /**
   * List all terrain levels encountered at this point along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {TerrainLevel[]} Terrains at that location.
   */
  terrainLevelsAtT(t) {
    const mark = this._pathMarkerAtT(t);
    if ( !mark ) return [];
    return this.constructor.terrainLevelsForKey(mark.terrainKey);
  }

  /**
   * Active unique terrains active at this point along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {Set<Terrain>} Active terrains at this location, given the path elevation.
   */
  activeTerrainsAtT(t) {
    const terrainLevels = this.activeTerrainLevelsAtT(t);
    return new Set(terrainLevels.map(t => t.terrain));
  }

  /**
   * List terrain levels that are enabled given the elevation of the path at this point.
   * Depending on the terrain setting, it may be enabled for a specific fixed elevation range,
   * or be enabled based on a range relative to the ground terrain or the layer elevation.
   * @param {number} t    Percent distance along the ray
   * @returns {TerrainLevel[]} Terrains enabled at that location.
   */
  activeTerrainLevelsAtT(t) {
    const mark = this._pathMarkerAtT(t);
    if ( !mark ) return [];

    // Filter the active terrains based on elevation and position at this mark.
    const location = this.pointAtT(t);
    const elevation = mark.elevation;
    const terrains = this.constructor.terrainLevelsForKey(mark.terrainKey);
    return terrains.filter(t => t.activeAt(elevation, location));
  }

  /**
   * Path marker object at a given percentage distance along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {object|undefined} The maker
   */
  _pathMarkerAtT(t) {
    const path = this.path;
    if ( t >= 1 ) return path.at(-1);
    if ( t <= 0 ) return path.at(0);
    return path.findLast(mark => mark.t <= t);
  }

  /**
   * Unique terrains on the ray nearest to a point on the canvas.
   * @param {Point} pt    Point to check
   * @returns {TerrainLevel[]} Terrains nearest to that location on the ray.
   */
  terrainsAtClosestPoint(pt) { return this.terrainsAtT(this.tForPoint(pt)); }

  /**
   * Unique terrains that are enabled given the elevation of the path at the point
   * on the ray nearest to this canvas point.
   * @param {Point} pt    Point to check
   * @returns {TerrainLevel[]} Terrains enabled nearest to that location on the ray.
   */
  activeTerrainsAtClosestPoint(pt) { return this.activeTerrainsAtT(this.tForPoint(pt)); }

  /**
   * List terrain levels on the ray nearest to a point on the canvas.
   * @param {Point} pt    Point to check
   * @returns {TerrainLevel[]} Terrains nearest to that location on the ray.
   */
  terrainLevelsAtClosestPoint(pt) { return this.terrainLevelsAtT(this.tForPoint(pt)); }

  /**
   * List terrain levels that are enabled given the elevation of the path at the point
   * on the ray nearest to this canvas point.
   * @param {Point} pt    Point to check
   * @returns {TerrainLevel[]} Terrains enabled nearest to that location on the ray.
   */
  activeTerrainLevelsAtClosestPoint(pt) { return this.activeTerrainLevelsAtT(this.tForPoint(pt)); }

  /**
   * Closest point on the ray and return the t value for that location.
   * @param {Point} pt    Point to use to determine the closest point to the ray
   * @returns {number} The t value, where origin = 0, destination = 1
   */
  tForPoint(pt) {
    const { origin, destination } = this;
    const origin2d = origin.to2d();
    const dest2d = destination.to2d();

    if ( origin2d.almostEqual(pt) ) return 0;
    if ( dest2d.almostEqual(pt) ) return 1;
    if ( origin2d.almostEqual(dest2d) ) return 0;

    const rayPt = foundry.utils.closestPointToSegment(pt, origin2d, dest2d);
    const dist2 = PIXI.Point.distanceSquaredBetween(origin2d, rayPt);
    const delta = dest2d.subtract(origin2d);
    return Math.sqrt(dist2 / delta.magnitudeSquared());
  }

  /**
   * Tiles with terrains that overlap this travel ray.
   * @returns {Set<Tile>}
   */
  terrainTilesInPath() {
    const { origin, destination } = this;
    const xMinMax = Math.minMax(origin.x, destination.x);
    const yMinMax = Math.minMax(origin.y, destination.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    const collisionTest = (o, _rect) => o.t.hasAttachedTerrain
      && o.t.bounds.lineSegmentIntersects(origin, destination, { inside: true });
    return canvas.tiles.quadtree.getObjects(bounds, { collisionTest });
  }

  /**
   * @typedef {object} Marker
   *
   * Object that represents a point along the path where the terrain set changes.
   * Only in the flat 2d dimensions. Elevation handled elsewhere (active terrains).
   * From that t position onward towards t = 1, terrains are as provided in the set.
   * @property {number} t                     Percentage along the travel ray
   * @property {Set<TerrainLevel>} terrains   What terrains are found at that t location
   * @property {number} elevation             Elevation at this t
   * @property {string} type                  Originating type for this marker. elevation|tile|canvas|template
   */

  /**
   * Get each point at which there is a terrain change.
   */
  _walkPath() {
    const path = this.#path;
    path.length = 0;

    // Retrieve points of change along the ray:
    // 1. elevation
    // 2. canvas terrain layers
    // 3. tile terrain layers
    // 4. TODO: template terrain layers

    const elevationMarkers = this._elevationMarkers();
    const canvasTerrainMarkers = this._canvasTerrainMarkers();
    const tileTerrainMarkers = this._tilesTerrainMarkers();

    // Combine and sort from t = 0 to t = 1.
    const combinedMarkers = [
      ...elevationMarkers,
      ...canvasTerrainMarkers,
      ...tileTerrainMarkers
    ].sort((a, b) => a.t - b.t);
    if ( !combinedMarkers.length ) return [];

    // Walk along the markers, indicating at each step:
    // - What terrains are present from this point forward.
    // - What the current elevation step is from this point forward.
    // Must track each terrain marker set to know when terrains have been removed.
    let currCanvasTerrains = new Set();
    let currTileTerrains = new Set();
    const finalMarkers = [];

    // Initialize.
    let prevMarker = { t: 0, terrains: new Set() };
    finalMarkers.push(prevMarker);

    // Combine markers with the same t (2d location).
    // Track terrain levels that are present at each location.
    for ( const marker of combinedMarkers ) {
      const sameT = marker.t.almostEqual(prevMarker.t);
      const currMarker = sameT ? prevMarker : mergeObject(prevMarker, { t: marker.t }, { inplace: false });
      if ( !sameT ) finalMarkers.push(currMarker);
      switch ( marker.type ) {
        case "elevation": {
          currMarker.elevation = marker.elevation;
          break;
        }
        case "canvas": {
          currCanvasTerrains = marker.terrains;
          currMarker.terrains = currTileTerrains.union(currCanvasTerrains); // Copy
          break;
        }
        case "tile": {
          currTileTerrains = marker.terrains;
          currMarker.terrains = currTileTerrains.union(currCanvasTerrains); // Copy
          break;
        }
      }
    }

    // Trim where the terrains and elevation have not changed from the previous step.
    prevMarker = finalMarkers[0];
    this.#path.push(prevMarker);
    const numMarkers = finalMarkers.length;
    for ( let i = 1; i < numMarkers; i += 1 ) {
      const currMarker = finalMarkers[i];
      if ( prevMarker.elevation === currMarker.elevation
        && prevMarker.terrains.equals(currMarker.terrains) ) {
        console.debug("TravelTerrainRay skipping duplicate marker.");
        continue;
      }
      this.#path.push(currMarker);
      prevMarker = currMarker;
    }
    return this.#path;
  }

  /**
   * Retrieve elevation change markers along the path.
   * @returns {Marker[]}
   */
  _elevationMarkers() {
    if ( !game.modules.get("elevatedvision")?.active ) return [];
    const ter = new canvas.elevation.TravelElevationRay(this.#token,
      { origin: this.origin, destination: this.destination });
    const evMarkers = ter._walkPath();
    return evMarkers.map(obj => {
      return {
        t: obj.t,
        elevation: obj,
        type: "elevation"
      };
    });
  }

  /**
   * Retrieve canvas terrain change markers along the path.
   * @returns {Marker[]}
   */
  _canvasTerrainMarkers() {
    const pixelCache = canvas.terrain.pixelCache;
    const terrainMarkers = pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(
      this.origin, this.destination, this.#markTerrainFn);
    return terrainMarkers.map(obj => {
      const key = new TerrainKey(obj.currPixel);
      return {
        t: this.tForPoint(obj),
        terrains: new Set(canvas.terrain._layersToTerrainLevels(key.toTerrainLayers())),
        type: "canvas"
      };
    });
  }

  /**
   * Retrieve tile terrain change markers along the path
   * @returns {Marker[]}
   */
  _tilesTerrainMarkers() {
    const { origin, destination } = this;
    const xMinMax = Math.minMax(origin.x, destination.x);
    const yMinMax = Math.minMax(origin.y, destination.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    const collisionTest = (o, _rect) => {
      const tile = o.t;
      if ( !tile.hasAttachedTerrain ) return false;
      const pixelCache = tile.evPixelCache;
      const thresholdBounds = pixelCache.getThresholdCanvasBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
      return thresholdBounds.lineSegmentIntersects(origin, destination, { inside: true });
    };
    const tiles = canvas.tiles.quadtree.getObjects(bounds, { collisionTest });
    const markers = [];
    tiles.forEach(tile => {
      const tileMarkers = this._tileTerrainMarker(tile);
      markers.push(...tileMarkers);
    });
    return markers;
  }

  /**
   * Retrieve tile terrain change markers along the path for a single tile.
   * @param {Tile} tile
   * @returns {Marker[]]}
   */
  _tileTerrainMarker(tile) {
    if ( !tile.hasAttachedTerrain ) return [];

    // If tile alpha is set to 1, tile is treated as fully transparent.
    const tileAlpha = tile.document.getFlag(MODULE_ID, FLAGS.ALPHA_THRESHOLD);
    if ( tileAlpha === 1 ) return [];

    // If the tile should be treated as opaque, just identify the entry and exit points along the ray.
    // May have only one if start or end point is within the bounds.
    const terrains = new Set([tile.attachedTerrain]);
    const nullSet = new Set();
    const pixelCache = tile.evPixelCache;
    const { origin, destination } = this;
    if ( !tileAlpha ) {
      const thresholdBounds = pixelCache.getThresholdCanvasBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
      const ixs = thresholdBounds.segmentIntersections(origin, destination);
      const markers = [];

      // We can reasonably assume in/out pattern. So if we start inside the tile, the first
      // intersection is outside, and vice-versa.
      let inside = thresholdBounds.contains(origin.x, origin.y);
      if ( inside ) markers.push({
        t: 0,
        terrains
      });
      for ( const ix of ixs ) {
        inside ^= true; // Alternate true/false.
        markers.push({
          t: this.tForPoint(ix),
          terrains: inside ? terrains : nullSet,
          type: "tile"
        });
      }
      return markers;
    }

    // Track the ray across the tile, locating points where transparency starts or stops.
    const markTileFn = (curr, prev) => (prev < tileAlpha) ^ (curr < tileAlpha);
    const tileMarkers = pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(
      origin, destination, markTileFn, { alphaThreshold: CONFIG[MODULE_ID].alphaThreshold });
    return tileMarkers.map(obj => {
      return {
        t: this.tForPoint(obj),
        terrains: obj.currPixel < tileAlpha ? nullSet : terrains
      };
    });
  }

  /**
   * Determine the active terrains along the 3d path.
   * If elevation is set for the path markers, elevation moves in steps.
   * Otherwise, elevation is pro-rated between origin and destination elevations.
   * For each terrain encountered, find the actual active start point along the 3d ray.
   * Add that active marker and remove the level marker.
   * Keep the active marker only if its terrain is active when we get to that t point.
   */



}
