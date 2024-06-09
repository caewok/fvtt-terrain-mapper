/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Hexagon } from "./geometry/RegularPolygon/Hexagon.js";

// Class to handle the import/export of terrain grid hexagons.
// JSON representation is a single point (a grid position).
// Same as TerrainGridSquare

export class TerrainGridHexagon extends Hexagon {

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
   * @type {GridCoordinates}  { i: row, j: col } location
   */
  get gridPosition() { return canvas.grid.getOffset(this.origin, this.origin); }

  /**
   * Construct a grid square from a given canvas location.
   * @param {number} x
   * @param {number} y
   * @returns {Square}
   */
  static fromLocation(x, y) {
    const tl = canvas.grid.getTopLeftPoint({ x, y });
    return this._fromTopLeft(tl.x, tl.y);
  }

  /**
   * Construct a grid square from a grid row, col position.
   * @param {number} row
   * @param {number} col
   * @returns {Square}
   */
  static fromGridPosition(gridCoords) {
    const tl = canvas.grid.getTopLeftPoint(gridCoords);
    return this._fromTopLeft(tl.x, tl.y);
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
    const width = canvas.grid.grid.w;
    const height = canvas.grid.grid.h;
    return new this({ x: tlx + (width * 0.5), y: tly + (height * 0.5) }, undefined, { width, height });
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
      type: "TerrainGridHexagon"
    };
  }

  /**
   * Convert from JSON.
   * @param {object} json
   * @returns {TerrainGridSquare}
   */
  static fromJSON(json) {
    if ( !(Object.hasOwn(json, "gridPosition") && Object.hasOwn(json, "pixelValue")) ) {
      console.error("Error importing json for TerrainGridHexagon.", json);
      return undefined;
    }

    const { pixelValue, layer } = json;

    // Convert older JSON format.
    const gridPosition = json.gridPosition instanceof Array
      ? { i: json.gridPosition[0], j: json.gridPosition[1] } : json.gridPosition;

    const sq = this.fromGridPosition(gridPosition);
    sq.pixelValue = pixelValue;
    sq.layer = layer;
    return sq;
  }

  /**
   * Does this grid shape envelop some other shape?
   * @param {TerrainShape} other
   * @returns {boolean}
   */
  envelops(other) {
    if ( other instanceof TerrainGridHexagon ) {
      const gridCoords = this.gridPosition;
      const otherGridCoords = other.gridPosition;
      return gridCoords.i === otherGridCoords.i && gridCoords.j === otherGridCoords.j;
    }
    return super.envelops(other)
  }
}
