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

import { MODULE_ID, FLAGS, MODULES_ACTIVE } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { TerrainKey } from "./TerrainPixelCache.js";
import { log } from "./util.js";

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

  /** @type {object[]} */
  #activePath = [];

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

  /** @type {PIXI.Point} */
  #origin = new Point3d();

  get origin() { return this.#origin; }

  set origin(value) {
    this.#origin.copyFrom(value);
    this.#path.length = 0;
  }

  /** @type {PIXI.Point} */
  #destination = new Point3d();

  get destination() { return this.#destination; }

  set destination(value) {
    this.#destination.copyFrom(value);
    this.#path.length = 0;
  }

  /** @type {object[]} */
  #path = [];

  get path() {
    if ( !this.#path.length ) this._walkPath();
    return this.#path;
  }

  get activePath() {
    if ( !this.#activePath.length ) this._constructActivePath();
    return this.#activePath;
  }

  /**
   * Clear path and active path.
   */
  clearPath() {
    this.#path.length = 0;
    this.#activePath.length = 0;
  }

  /**
   * Clear the active path only.
   */
  clearActivePath() {
    this.#activePath.length = 0;
  }

  /**
   * @param {number} t      Percent distance along origin --> destination ray in 2d.
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.origin.to2d().projectToward(this.destination.to2d(), t); }

  /**
   * List all terrain levels encountered at this point along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {Set<TerrainLevel>} Terrains at that location.
   */
  terrainLevelsAtT(t) {
    const mark = this.constructor.markerAtT(t, this.path);
    if ( !mark ) return new Set();
    return mark.terrains;
  }

  /**
   * Active unique terrains active at this point along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {Set<Terrain>} Active terrains at this location, given the path elevation.
   */
  activeTerrainsAtT(t) {
    const mark = this.constructor.markerAtT(t, this.activePath);
    if ( !mark ) return new Set();
    return mark.terrains;
  }

  /**
   * Path marker object at a given percentage distance along the path.
   * @param {number} t    Percent distance along the ray
   * @returns {object|undefined} The maker
   */
  static markerAtT(t, path) {
    if ( t >= 1 ) return path.at(-1);
    if ( t <= 0 ) return path.at(0);
    return path.findLast(mark => mark.t <= t);
  }

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
   * Find closest point on the ray and return the t value for that location.
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
    this.clearPath();
    const path = this.#path;

    // Retrieve points of change along the ray:
    // Combine and sort from t = 0 to t = 1.
    const combinedMarkers = [
      ...this._elevationMarkers(),
      ...this._canvasTerrainMarkers(),
      ...this._tilesTerrainMarkers(),
      ...this._templatesTerrainMarkers()
    ].sort((a, b) => a.t - b.t);

    if ( !combinedMarkers.length ) return [];

    // Walk along the markers, indicating at each step:
    // - What terrains are present from this point forward.
    // - What the current elevation step is from this point forward.
    // Must track each terrain marker set to know when terrains have been removed.
    const currTerrains = {
      canvas: new Set(),
      tile: new Set(),
      template: new Set()
    };

    // Initialize.
    let prevMarker = { t: 0, terrains: new Set() };
    const finalMarkers = [prevMarker];

    // Combine markers with the same t (2d location).
    // Track terrain levels that are present at each location.
    for ( const marker of combinedMarkers ) {
      const sameT = marker.t.almostEqual(prevMarker.t);
      const currMarker = sameT ? prevMarker : mergeObject(prevMarker, { t: marker.t }, { inplace: false });
      if ( !sameT ) finalMarkers.push(currMarker);
      if ( marker.type === "elevation" ) {
        currMarker.elevation = marker.elevation.elevation;
        continue;
      }
      currTerrains[marker.type] = marker.terrains;
      currMarker.terrains = currTerrains.canvas.union(currTerrains.tile).union(currTerrains.template); // Copy
    }
    return this.#trimPath(finalMarkers, path);
  }

  /**
   * Trim path markers where terrains and elevation have not changed from the previous marker.
   * @param {Marker[]} oldPath            Array of markers to trim
   * @param {Marker[]} [trimmedPath=[]]   Optional (usually empty) array to place the trimmed markers
   * @returns {Marker[]} The trimmedPath array, for convenience.
   */
  #trimPath(oldPath, trimmedPath = [], skipElevation = false) {
    let prevMarker = oldPath[0];
    trimmedPath.push(prevMarker);
    const numMarkers = oldPath.length;
    for ( let i = 1; i < numMarkers; i += 1 ) {
      const currMarker = oldPath[i];
      if ( (skipElevation || prevMarker.elevation === currMarker.elevation)
        && prevMarker.terrains.equals(currMarker.terrains) ) {
        log("TravelTerrainRay skipping duplicate marker.");
        continue;
      }
      trimmedPath.push(currMarker);
      prevMarker = currMarker;
    }
    return trimmedPath;
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
    const markers = evMarkers.map(obj => {
      return {
        t: obj.t,
        elevation: obj,
        type: "elevation"
      };
    });

    if ( !markers[0] || markers[0].t !== 0 ) markers.push({
      t: 0,
      elevation: canvas.elevation.elevationAt(this.origin),
      type: "elevation"
    });

    if ( markers.at(-1).t !== 1 ) markers.push({
      t: 1,
      elevation: canvas.elevation.elevationAt(this.destination),
      type: "elevation"
    });
    return markers;
  }

  /**
   * Retrieve canvas terrain change markers along the path.
   * @returns {Marker[]}
   */
  _canvasTerrainMarkers() {
    const pixelCache = canvas.terrain.pixelCache;
    const terrainMarkers = pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(
      this.origin, this.destination, this.#markTerrainFn);
    const markers = terrainMarkers.map(obj => {
      const key = new TerrainKey(obj.currPixel);
      return {
        t: this.tForPoint(obj),
        terrains: new Set(canvas.terrain._layersToTerrainLevels(key.toTerrainLayers())),
        type: "canvas"
      };
    });

    if ( !markers[0] || markers[0].t !== 0 ) markers.push({
      t: 0,
      terrains: canvas.terrain.terrainLevelsAt(this.origin),
      type: "canvas"
    });

    if ( markers.at(-1).t !== 1 ) markers.push({
      t: 1,
      terrains: canvas.terrain.terrainLevelsAt(this.destination),
      type: "canvas"
    });
    return markers;
  }

  /**
   * Retrieve tile terrain change markers along the path
   * @returns {Marker[]}
   */
  _tilesTerrainMarkers() {
    const { origin, destination } = this;
    const collisionTest = (o, _rect) => {
      const tile = o.t;
      if ( !tile.hasAttachedTerrain ) return false;
      const pixelCache = tile.evPixelCache;
      const thresholdBounds = pixelCache.getThresholdCanvasBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
      return thresholdBounds.lineSegmentIntersects(origin, destination, { inside: true });
    };

    return this.#placeablesTerrainMarkers(
      canvas.tiles.quadtree,
      collisionTest,
      this._tileTerrainMarkers.bind(this));
  }

  /**
   * Retrieve tile terrain change markers along the path for a single tile.
   * @param {Tile} tile
   * @returns {Marker[]]}
   */
  _tileTerrainMarkers(tile) {
    if ( !tile.hasAttachedTerrain ) return [];

    // If tile alpha is set to 1, tile is treated as fully transparent.
    const tileAlpha = tile.document.getFlag(MODULE_ID, FLAGS.ALPHA_THRESHOLD);
    if ( tileAlpha === 1 ) return [];

    // If the tile should be treated as opaque, just identify the entry and exit points along the ray.
    // May have only one if start or end point is within the bounds.
    const pixelCache = tile.evPixelCache;
    if ( !tileAlpha ) {
      const thresholdBounds = pixelCache.getThresholdCanvasBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
      return this.#placeableTerrainMarkers(tile, "tile", thresholdBounds);
    }

    // If the tile should be treated as opaque, just identify the entry and exit points along the ray.
    // May have only one if start or end point is within the bounds.
    const terrains = new Set([tile.attachedTerrain]);
    const nullSet = new Set();
    const { origin, destination } = this;

    // Track the ray across the tile, locating points where transparency starts or stops.
    const pixelAlpha = tileAlpha * 255; // Convert alpha percentage to pixel values.
    const markTileFn = (curr, prev) => (prev < pixelAlpha) ^ (curr < pixelAlpha); // Find change above/below threshold.
    const tileMarkers = pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(
      origin, destination, markTileFn, { alphaThreshold: CONFIG[MODULE_ID].alphaThreshold });
    return tileMarkers.map(obj => {
      const [addTerrains, removeTerrains] = obj.currPixel < pixelAlpha ? [nullSet, terrains] : [terrains, nullSet];
      return {
        t: this.tForPoint(obj),
        addTerrains,
        removeTerrains,
        type: "tile"
      };
    });
  }

  /**
   * Retrieve tile terrain change markers along the path
   * @returns {Marker[]}
   */
  _templatesTerrainMarkers() {
    const { origin, destination } = this;
    const collisionTest = (o, _rect) => {
      const template = o.t;
      if ( !template.hasAttachedTerrain ) return false;
      const shape = template.shape.translate(template.x, template.y);
      return shape.lineSegmentIntersects(origin, destination, { inside: true });
    };

    return this.#placeablesTerrainMarkers(
      canvas.templates.quadtree,
      collisionTest,
      this._templateTerrainMarkers.bind(this));
  }

  /**
   * Helper method to retrieve placeable object change markers along the path.
   */
  #placeablesTerrainMarkers(quadtree, collisionTest, markerFn) {
    const { origin, destination } = this;
    const xMinMax = Math.minMax(origin.x, destination.x);
    const yMinMax = Math.minMax(origin.y, destination.y);
    const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    const placeables = quadtree.getObjects(bounds, { collisionTest });
    const markers = [];
    placeables.forEach(placeable => markers.push(...markerFn(placeable)));
    markers.sort((a, b) => a.t - b.t);

    // Combine the different tiles.
    const currTerrains = new Set();
    for ( const marker of markers ) {
      marker.addTerrains.forEach(t => currTerrains.add(t));
      marker.removeTerrains.forEach(t => currTerrains.delete(t));
      marker.terrains = new Set(currTerrains);
    }
    return markers;
  }

  /**
   * Retrieve template terrain change markers along the path for a single template.
   * @param {MeasuredTemplate} template
   * @returns {Marker[]]}
   */
  _templateTerrainMarkers(template) {
    const shape = template.shape.translate(template.x, template.y);
    return this.#placeableTerrainMarkers(template, "template", shape);
  }

  /**
   * Helper method to return a set of markers for a single placeable encountered along the path.
   */
  #placeableTerrainMarkers(placeable, type, bounds) {
    if ( !placeable.hasAttachedTerrain ) return [];

    // If the tile should be treated as opaque, just identify the entry and exit points along the ray.
    // May have only one if start or end point is within the bounds.
    const placeables = new Set([placeable.attachedTerrain]);
    const nullSet = new Set();
    const { origin, destination } = this;
    const ixs = bounds.segmentIntersections(origin, destination);
    const markers = [];

    // We can reasonably assume in/out pattern. So if we start inside the template, the first
    // intersection is outside, and vice-versa.
    let inside = bounds.contains(origin.x, origin.y);
    if ( inside ) markers.push({
      t: 0,
      addTerrains: placeables,
      removeTerrains: nullSet,
      type
    });
    for ( const ix of ixs ) {
      inside ^= true; // Alternate true/false.
      const [addTerrains, removeTerrains] = inside ? [placeables, nullSet] : [nullSet, placeables];
      markers.push({
        t: this.tForPoint(ix),
        addTerrains,
        removeTerrains,
        type
      });
    }
    return markers;
  }


  /**
   * Determine the active terrains along the 3d path.
   * If elevation is set for the path markers, elevation moves in steps.
   * Otherwise, elevation is pro-rated between origin and destination elevations.
   * For each terrain encountered, find the actual active start point along the 3d ray.
   * Add that active marker and remove the level marker.
   * Keep the active marker only if its terrain is active when we get to that t point.
   * Terrains cannot duplicate, so if the same terrain is active from, say, tile and canvas,
   * only one applies.
   */
  _constructActivePath() {
    this.clearActivePath();
    const path = this.path;
    if ( !path.length ) return [];
    const activePath = this.#activePath;

    // For each terrain, determine its starting and ending t value based on elevation and position.
    // Insert into array the start and end.
    // Then walk the array, tracking what is active.
    const tValues = [];
    const elevationChange = !this.origin.z.almostEqual(this.destination.z);
    const steppedElevation = MODULES_ACTIVE.ELEVATED_VISION || !elevationChange;
    let currLevels = new Set();

    for ( const marker of path ) {
      const t = marker.t;
      const removedLevels = currLevels.difference(marker.terrains);
      const location = this.point3dAtT(t);
      const elevation = marker.elevation ?? location.z;
      currLevels = marker.terrains;
      removedLevels.forEach(level => tValues.push({ t, removeTerrain: level.terrain, elevation }));

      for ( const terrainLevel of marker.terrains ) {
        const terrain = terrainLevel.terrain;
        const { min: minZ, max: maxZ} = terrainLevel.elevationRangeZ(location); // TODO: Need pixel units, not grid units
        const currentlyActive = elevation.between(minZ, maxZ);
        if ( currentlyActive ) tValues.push({ t, addTerrain: terrain, elevation });

        // If elevation is stepped using EV, then every elevation change along the path is marked.
        // We can assume fixed elevation until the next elevation change.
        // So if the terrain is active, we can simply add it.
        if ( steppedElevation ) continue;

        // Determine the start and end points.
        const minT = this.tForElevation(minZ);
        const maxT = this.tForElevation(maxZ);
        const [startT, endT] = minT > maxT ? [maxT, minT] : [minT, maxT];
        if ( startT > t && startT <= 1) tValues.push({
          t: startT,
          addTerrain: terrain,
          elevation: this.point3dAtT(startT).z });
        if ( endT > t && endT <= 1 ) tValues.push({
          t: endT,
          removeTerrain: terrain,
          elevation: this.point3dAtT(endT).z });
      }
    }

    // Sort lower t values first.
    tValues.sort((a, b) => a.t - b.t);

    // Now consolidate the t value array, tracking active terrains as we go.
    // Similar to walkPath.
    // Initialize.
    let prevMarker = { t: 0, elevation: this.origin.z, terrains: new Set() };
    const finalMarkers = [prevMarker];
    for ( const marker of tValues ) {
      const sameT = marker.t.almostEqual(prevMarker.t);
      const currMarker = sameT ? prevMarker : {
        t: marker.t,
        elevation: marker.elevation,
        terrains: new Set(prevMarker.terrains) };
      if ( !sameT ) finalMarkers.push(currMarker);
      if ( marker.addTerrain ) currMarker.terrains.add(marker.addTerrain);
      if ( marker.removeTerrain ) currMarker.terrains.delete(marker.removeTerrain);
      prevMarker = currMarker;
    }

    // Trim where terrains and elevation have not changed from the previous step.
    // If EV is not active, we can trim the duplicate terrains regardless of elevation,
    // because elevation is calculated.
    const skipElevation = !MODULES_ACTIVE.ELEVATED_VISION;
    return this.#trimPath(finalMarkers, activePath, skipElevation);
  }

  /**
   * @param {number} t      Percent distance along origin --> destination ray
   * @returns {Point3d}
   */
  point3dAtT(t) { return this.origin.projectToward(this.destination, t); }

  /**
   * For given elevation, find where on the ray that elevation occurs.
   * @param {number} z    Elevation to find, in pixel coordinates.
   * @returns {number|undefined} The t value, where origin = 1, destination = 1.
   *   Undefined if elevation does not change.
   */
  tForElevation(z) {
    const { origin, destination } = this;
    if ( origin.z.almostEqual(destination.z) ) return undefined;
    const dz = destination.z - origin.z;
    return (z - origin.z) / dz;
  }

}

/* Testing
Point3d = CONFIG.GeometryLib.threeD.Point3d
let [target] = game.user.targets
token = canvas.tokens.controlled[0]
destination = Point3d.fromTokenCenter(target);
origin = Point3d.fromTokenCenter(token)
ttr = new canvas.terrain.TravelTerrainRay(_token, { origin, destination })

ttr._canvasTerrainMarkers()
ttr._tilesTerrainMarkers()
ttr._walkPath()
ttr._constructActivePath()


// Spit out t and terrain names in the set
function pathSummary(path) {
  pathObj = path.map(obj => {
    return { t: obj.t, elevation: obj.elevation, terrains: [...obj.terrains].map(t => t.name).join(", ") }
  });
  console.table(pathObj);
  return pathObj;
}

path = ttr._walkPath();
activePath = ttr._constructActivePath();
pathSummary(path)
pathSummary(activePath)

pathObj = path.map(obj => {
  return { t: obj.t, terrains: [...obj.terrains].map(t => t.id).join(", ") }
})
console.table(pathObj)

*/
