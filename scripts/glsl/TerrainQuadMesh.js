/* global
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

/**
 * Mesh that takes a rectangular frame instead of a geometry.
 * @param {PIXI.Rectangle} rect
 */
export class TerrainQuadMesh extends PIXI.Mesh {
  constructor(rect, shader, state, drawMode) {
    const geometry = TerrainQuadMesh.calculateQuadGeometry(rect);
    super(geometry, shader, state, drawMode);
    this.rect = new PIXI.Rectangle();
    this.rect.copyFrom(rect);
  }

  /**
   * Construct a geometry that represents a rectangle on the canvas.
   * Adds vertex coordinates and texture UV coordinates.
   * @param {PIXI.Rectangle} rect   Rectangle to use for the frame.
   * @returns {PIXI.Geometry}
   */
  static calculateQuadGeometry(rect) {
    const geometry = new PIXI.Geometry();
    geometry.addAttribute("aVertexPosition", this.aVertexPosition(rect), 2);
    geometry.addAttribute("aTextureCoord", this.aTextureCoord, 2);
    geometry.addIndex([0, 1, 2, 0, 2, 3]);
    return geometry;
  }

  static aVertexPosition(rect) {
    const { left, right, top, bottom } = rect;
    return [
      left, top,      // TL
      right, top,   // TR
      right, bottom, // BR
      left, bottom  // BL
    ];
  }

  static aTextureCoord = [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1 // BL
  ];

  get aVertexPosition() {
    return this.constructor.aVertexPosition(this.rect);
  }

  updateGeometry(_newRect) { return; } // eslint-disable-line no-useless-return
}

export class TerrainUpdatingQuadMesh extends TerrainQuadMesh {
  updateGeometry(newRect) {
    if ( this.rect.x === newRect.x
      && this.rect.y === newRect.y
      && this.rect.width === newRect.width
      && this.rect.height === newRect.height ) return;

    this.rect.copyFrom(newRect);
    this.geometry.getBuffer("aVertexPosition").update(this.aVertexPosition);
  }
}
