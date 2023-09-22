/* globals

*/
"use strict";

// FILO queue.
// Used by ElevationLayerToolBar to store undo history
export class FILOQueue {
  constructor(max = 50) {
    this.elements = [];
    this.max = max;
  }

  get length() {
    return this.elements.length;
  }

  enqueue(element) {
    this.elements.push(element);
    if ( this.elements.length > this.max ) this.elements.shift();
  }

  dequeue() {
    return this.elements.pop();
  }

  peek() {
    return this.elements[this.length - 1];
  }
}
