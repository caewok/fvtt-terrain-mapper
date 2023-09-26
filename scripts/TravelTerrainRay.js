/* globals
canvas,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";

/* Testing
  Point3d = CONFIG.GeometryLib.threeD.Point3d

  origin = new Point3d();
  destination = new Point3d();

  token = canvas.tokens.controlled[0];
  destination.copyFrom(game.user.targets.values().next().value.center);

  origin.copyFrom(token.center);
  origin.z = token.elevationZ;

  ter = new canvas.elevation.TravelElevationRay(this.token, { origin, destination });
  evPath = ter._walkPath();

  markTerrainFn = (curr, prev) => curr !== prev;
  terrainChanges = canvas.terrain.pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(origin, destination, markTerrainFn)

  ttr = new canvas.terrain.TravelTerrainRay(token, { destination })
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
   * Get the closest point on the ray and return the t value for that location.
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
   * Get each point at which there is a terrain change.
   */
  _walkPath() {
    const path = this.#path;
    path.length = 0;
    let evMarkers = [];
    const { pixelCache } = canvas.terrain;

    if ( game.modules.get("elevatedvision")?.active ) {
      const ter = new canvas.elevation.TravelElevationRay(this.#token,
        { origin: this.origin, destination: this.destination });
      evMarkers = ter._walkPath();
    }

    // Find all the points of terrain change.
    // TODO: Handle layers.
    const terrainMarkers= pixelCache._extractAllMarkedPixelValuesAlongCanvasRay(
      this.origin, this.destination, this.#markTerrainFn);
    terrainMarkers.forEach(obj => {
      obj.t = this.tForPoint(obj);
    });

    // Add each terrain and elevation to a map and then combine into a single entry for each t.
    const markerMap = this._markerMap;
    markerMap.clear();
    evMarkers.forEach(m => markerMap.set(m.t, { elevation: m }));
    terrainMarkers.forEach(m => {
      if ( markerMap.has(m.t) ) {
        const marker = markerMap.get(m.t);
        marker.terrain = m;
      } else markerMap.set(m.t, { terrain: m });
    });

    let currTerrain = canvas.terrain.terrainAt(this.origin);
    let currE = this.origin.z;
    const tValues = [...markerMap.keys()].sort((a, b) => a - b);
    for ( const t of tValues ) {
      const markerObj = markerMap.get(t);
      const pathObj = {};
      const eObj = markerObj.elevation;
      const tObj = markerObj.terrain;

      if ( eObj ) {
        eObj.currElevationPixel = eObj.currPixel;
        eObj.prevElevationPixel = eObj.prevPixel;
        foundry.utils.mergeObject(pathObj, eObj);
        pathObj.terrain = currTerrain;
        currE = pathObj.elevation;
      }

      if ( tObj ) {
        tObj.currTerrainPixel = tObj.currPixel;
        tObj.prevTerrainPixel = tObj.prevPixel;
        foundry.utils.mergeObject(pathObj, tObj);
        pathObj.elevation ??= currE;
        pathObj.terrain = canvas.terrain.terrainForPixel(tObj.currPixel);
        currTerrain = pathObj.terrain;
      }

      // Remove unneeded/confusing properties.
      delete pathObj.currPixel;
      delete pathObj.prevPixel;
      path.push(pathObj);
    }

    return this.#path;
  }
}
