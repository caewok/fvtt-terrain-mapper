/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FILOQueue } from "./FILOQueue.js";

/**
 * @typedef {TerrainGridSquare
            |TerrainGridHexagon
            |TerrainPolygon
            |TerrainShapeHoled} TerrainShape
 */
export class ShapeQueue extends FILOQueue {

  /**
   * Step through the elements looking for:
   *   1. Duplicate shape (same or zeroed)
   *   2. Shape completely obscured by a polygon shape
   * @param {number} skip    How many elements to skip before potentially removing?
   * @returns {object[]} The removed elements.
   */
  clean(skip = 0) {
    const ln = this.elements.length;
    const skipIdx = ln - skip;
    const removedElements = [];
    for ( let i = ln - 1; i > -1; i -= 1 ) {
      const topElem = this.elements[i];
      const topShape = topElem.shape;
      const removed = this._testShapesForRemoval(topShape, i, skipIdx);
      i -= removed.length;
      removedElements.push(...removed);
    }
    return removedElements;
  }

  /**
   * Test if a given shape, assumed to be at the top of the queue, blocks other
   * shapes below it. If it does, remove those duplicative shapes.
   * @param {TerrainShape} topShape   The shape to test
   * @param {number} i                What element index corresponds to this topShape
   * @param {number} skipIdx          Last index to skip before testing elements.
   * @returns {boolean} True if element(s) were removed.
   */
  _testShapesForRemoval(topShape, i, skipIdx) {
    const startIdx = Math.min(skipIdx - 1, i - 1);
    const removedElements = [];
    for ( let j = startIdx; j > -1; j -= 1 ) {
      const testShape = this.elements[j].shape;
      if ( topShape.envelops(testShape) ) removedElements.push(this.removeElementByIndex(j));
    }
    return removedElements;
  }

  /**
   * Convert this shape queue to JSON.
   */
  toJSON() { return this.elements.map(elem => elem.shape.toJSON()); }
}
