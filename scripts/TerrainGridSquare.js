/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Square } from "./geometry/RegularPolygon/Square.js";

// Class to handle the import/export of terrain grid squares.
// JSON representation is a single point (a grid position).

export class TerrainGridSquare extends Square {

  /** @type {number} */
  pixelValue = 0;

  /** @type {number} */
  layer = 0;

  constructor(origin, radius, opts = {}) {
    super(origin, radius, opts);
    if ( opts.pixelValue ) this.pixelValue = opts.pixelValue;
  }

  /**
   * Determine the grid location for this shape.
   * @type {[{number}, {number}]}  [row, col] location
   */
  get gridPosition() { return canvas.grid.grid.getGridPositionFromPixels(this.origin.x, this.origin.y); }

  /**
   * Construct a grid square from a given canvas location.
   * @param {number} x
   * @param {number} y
   * @returns {Square}
   */
  static fromLocation(x, y) {
    const [tlx, tly] = canvas.grid.grid.getTopLeft(x, y);
    return this._fromTopLeft(tlx, tly);
  }

  /**
   * Construct a grid square from a grid row, col position.
   * @param {number} row
   * @param {number} col
   * @returns {Square}
   */
  static fromGridPosition(row, col) {
    const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(row, col);
    return this._fromTopLeft(tlx, tly);

  }

  /**
   * Construct a grid square from the top left pixel
   * @param {number} tlx
   * @param {number} tly
   * @returns {Square}
   */
  static _fromTopLeft(tlx, tly) {
    const sz = canvas.dimensions.size;
    const sz1_2 = sz * 0.5;
    return new this({ x: tlx + sz1_2, y: tly + sz1_2 }, sz, { rotation: 45, width: sz });
  }

  /**
   * Convert to JSON. Stored as the origin point plus the pixel value.
   * Upon import, will be resized to current grid size.
   * @returns {object}
   */
  toJSON() {
    return {
      gridPosition: this.gridPosition,
      pixelValue: this.pixelValue,
      layer: this.layer,
      type: "TerrainGridSquare" };
    }

  /**
   * Convert from JSON.
   * @param {object} json
   * @returns {TerrainGridSquare}
   */
  static fromJSON(json) {
    if ( !(Object.hasOwn(json, "gridPosition") && Object.hasOwn(json, "pixelValue")) ) {
      console.error("Error importing json for TerrainGridSquare.", json);
      return undefined;
    }

    const { gridPosition, pixelValue, layer } = json;
    const sq = this.fromGridPosition(gridPosition);
    sq.pixelValue = pixelValue;
    sq.layer = layer;
    return sq;
  }
}
