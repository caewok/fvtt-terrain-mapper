/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainPolygon extends PIXI.Polygon {
  /** @type {number} */
  pixelValue = 0;

  /** @type PIXI.Point */
  origin = new PIXI.Point();

  constructor(...args) {
    super(...args);
    this.origin.copyFrom(this.center);
  }

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
      type: "TerrainPolygon"
    };
  }

  /**
   * Convert a PIXI.Polygon to a TerrainPolygon.
   * @param {PIXI.Polygon} poly
   * @param {number} [pixelValue=0]
   * @returns {TerrainPolygon}
   */
  static fromPolygon(poly, pixelValue = 0) {
    const shape = new this(poly.points);
    shape.pixelValue = pixelValue;
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

    const { pixelValue, points } = json;
    const poly = new PIXI.Polygon(points);
    poly.pixelValue = pixelValue;
    return poly;
  }
}
