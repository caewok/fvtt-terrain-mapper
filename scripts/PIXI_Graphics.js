/* globals
*/
"use strict";

import { ShapeHoled } from "./geometry/ShapeHoled.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Wrap PIXI.Graphics.drawShape.
 * If passed a polygon with an array of polygons property, use that to draw with holes.
 */
function drawShape(wrapped, shape) {
  if ( shape instanceof ShapeHoled ) {
    shape.draw(this);
    return this;
  }
  return wrapped(shape);
}

PATCHES.BASIC.MIXES = { drawShape };
