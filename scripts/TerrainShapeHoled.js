/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ShapeHoled } from "./geometry/ShapeHoled.js";
import { TerrainPolygon } from "./TerrainPolygon.js";

export class TerrainShapeHoled extends ShapeHoled {
  /** @type {number} */
  pixelValue = 0;

  /** @type PIXI.Point */
  origin = new PIXI.Point();

  constructor(shapes = [], { holes, origin, pixelValue } = {}) {
    super(...args);
    if ( origin ) this.origin.copyFrom(origin);
    else this.origin.copyFrom(this.bounds.center);

    if ( pixelValue ) this.pixelValue = pixelValue;

    // Transform all shapes into terrain shapes.
    this.shapes = this.shapes.map(s => this.#convertShapeToTerrainShape(s));
    this.holes = this.holes.map(s => this.#convertShapeToTerrainShape(s));
  }

  /**
   * Convert shape to terrain shape.
   * @param {Shape} shape
   * @returns {TerrainShape}
   */
  #convertShapeToTerrainShape(shape) {
    if ( s instanceof TerrainPolygon ) {
      s.pixelValue = this.pixelValue;
      return s;
    }
    return TerrainPolygon.fromPolygon(s.toPolygon(), this.pixelValue);
  }

  /**
   * Convert to JSON.
   * Stored as array of shapes, array of holes, and pixel value.
   * @returns {object}
   */
  toJSON() {
    return {
      shapes: this.shapes.map(s => s.toJSON()),
      holes: this.holes.map(s => s.toJSON()),
      pixelValue: this.pixelValue,
      origin: this.origin,
      type: "TerrainShapeHoled"
    };
  }

  /**
   * Convert from JSON.
   * @param {json} json
   * @returns {TerrainShapeHoled}
   */
  static fromJSON(json) {
    const shapes = json.shapes.map(s => TerrainPolygon.fromJSON(s));
    const holes = json.holes.map(s => TerrainPolygon.fromJSON(s));
    const { pixelValue, origin } = json;
    return new this([...shapes, ...holes], { pixelValue, origin });
  }

  /**
   * When adding a shape, convert to TerrainPolygon.
   * @param {Shape}
   */
  add(shape) {
    shape = this.#convertShapeToTerrainShape(shape);
    super.add(shape);
  }

  /**
   * When adding a hole, convert to TerrainPolygon.
   * @param {Shape}
   */
  addHole(shape) {
    shape = this.#convertShapeToTerrainShape(shape);
    super.add(shape);
  }
}
