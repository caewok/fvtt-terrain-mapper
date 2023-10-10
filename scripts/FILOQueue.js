/* globals

*/
"use strict";

/**
 * Basic first-in, last-out queue structure.
 */
export class FILOQueue {
  /** @type {*[]} */
  elements = [];

  /** @type {number} */
  get length() {
    return this.elements.length;
  }

  /**
   * Add object to the queue.
   * @param {object} element    Object to add to the queue.
   */
  enqueue(element) {
    this.elements.push(element);
  }

  /**
   * Remove object from the queue and return it.
   * @returns {object}
   */
  dequeue() {
    return this.elements.pop();
  }

  /**
   * Get next object in the queue without removing it.
   * @returns {object}
   */
  peek() {
    return this.elements[this.length - 1];
  }

  /**
   * Wipe the queue.
   */
  clear() {
    this.elements.length = 0;
  }

  /**
   * Remove a specific element from the queue by its index.
   * @param {number} idx    Index of element to remove
   * @returns {object} The removed element.
   */
  removeElementByIndex(idx) {
    return this.elements.splice(idx, 1)[0];
  }
}

/**
 * FILO queue that has a fixed length. Oldest items drop off.
 * Used to store, e.g., undo history.
 */
export class FILOFixedQueue extends FILOQueue {
  constructor(max = 50) {
    super();
    this.max = max;
  }

  enqueue(element) {
    super.enqueue(element);
    if ( this.elements.length > this.max ) this.elements.shift();
  }
}
