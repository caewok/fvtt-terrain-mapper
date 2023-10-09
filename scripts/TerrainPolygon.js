/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainPolygon extends PIXI.Polygon {
  /** @type {number} */
  pixelValue = 0;

  /** @type {number} */
  layer = 0;

  /** @type PIXI.Point */
  origin = new PIXI.Point();

  constructor(...args) {
    super(...args);
    this.origin = this.center;
  }

  set origin(value) { this.origin.copyFrom(value); }

  /**
   * Convert to JSON.
   * Stored as array of points plus the pixel value.
   * @returns {object}
   */
  toJSON() {
    // TODO: Should all points be pixel integers? If yes, should a point key be stored instead?
    return {
      pixelValue: this.pixelValue,
      points: this.points,
      layer: this.layer,
      origin: this.origin,
      type: "TerrainPolygon"
    };
  }

  /**
   * Convert a PIXI.Polygon to a TerrainPolygon.
   * @param {PIXI.Polygon} poly           Polygon to convert to TerrainPolygon
   * @param {object} [opts]               Options specific to Terrain polygons
   * @param {number} [opts.pixelValue=0]  Pixel value associated with this polygon
   * @param {number} [opts.layer]         Layer on which this polygon resides
   * @param {Point} [opts.origin]         Defined origin point, if not center of polygon
   * @returns {TerrainPolygon}
   */
  static fromPolygon(poly, { pixelValue = 0, layer = 0, origin } = {}) {
    const shape = new this(poly.points);
    shape.pixelValue = pixelValue;
    shape.layer = layer;
    if ( origin ) shape.origin = origin;
    return shape;
  }

  /**
   * Convert from JSON.
   * @param {object} json
   * @returns {TerrainPolygon}
   */
  static fromJSON(json) {
    if ( !(Object.hasOwn(json, "points") && Object.hasOwn(json, "pixelValue")) ) {
      console.error("Error importing json for TerrainPolygon.", json);
      return undefined;
    }

    const { pixelValue, points, layer, origin } = json;

    const poly = new this(points);
    poly.pixelValue = pixelValue;
    poly.layer = layer;
    poly.origin = origin;
    return poly;
  }
}
