/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class TerrainPolygon extends PIXI.Polygon {
  /** @type {number} */
  pixelValue = 0;

  /**
   * Convert to JSON.
   * Stored as array of points plus the pixel value.
   * @returns {object}
   */
  toJSON() {
    // TODO: Should all points be pixel integers? If yes, should a point key be stored instead?
    return {
      pixelValue: this.pixelValue,
      points: this.points
    };
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
