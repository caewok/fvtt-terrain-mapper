/* globals

*/
"use strict";

/**
 * Basic first-in, last-out queue structure.
 */
export class FILOQueue {
  /** @type {*[]} */
  elements = [];

  get length() {
    return this.elements.length;
  }

  enqueue(element) {
    this.elements.push(element);
  }

  dequeue() {
    return this.elements.pop();
  }

  peek() {
    return this.elements[this.length - 1];
  }

  clear() {
    this.elements.length = 0;
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
