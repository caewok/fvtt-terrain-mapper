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

  /** @type {number} */
  layer = 0;

  /** @type PIXI.Point */
  origin = new PIXI.Point();

  /**
   * @param {Shapes[]} shapes   One or more shapes to use. Holes marked with `isHole` property.
   * @param {object} [opts]     Options, passed to ShapeHoled constructor.
   * @param {Point} [opts.origin]         What point to treat as the origin, mostly for labeling.
   *   Defaults to the center of the bounding box.
   * @param {number} [opts.pixelValue]    What pixel value this shape should use.
   */
  constructor(shapes = [], opts = {}) {
    super(shapes, { });
    this.origin = opts.origin ?? this.bounds.center;
    if ( opts.pixelValue ) this.pixelValue = opts.pixelValue;
    if ( opts.layer ) this.layer = opts.layer;

    // Transform all shapes into terrain shapes.
    this.shapes = this.shapes.map(s => this.#convertShapeToTerrainShape(s));
    this.holes = this.holes.map(s => this.#convertShapeToTerrainShape(s));
  }

  set origin(value) { this.origin.copyFrom(value); }

  /**
   * Convert shape to terrain shape.
   * @param {Shape} shape
   * @returns {TerrainShape}
   */
  #convertShapeToTerrainShape(shape) {
    if ( shape instanceof TerrainPolygon ) {
      shape.pixelValue = this.pixelValue;
      return shape;
    }

    const { pixelValue, layer } = this;
    const poly = TerrainPolygon.fromPolygon(shape.toPolygon(), { pixelValue, layer });
    poly.isHole = shape.isHole;
    return poly;
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
      layer: this.layer,
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
    const holes = json.holes.map(s => {
      const poly = TerrainPolygon.fromJSON(s);
      poly.isHole = true;
      return poly;
    });

    const { pixelValue, origin, layer } = json;
    return new this([...shapes, ...holes], { pixelValue, layer, origin });
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
