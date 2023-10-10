/* globals
canvas
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Methods related to Canvas

/**
 * Track mouse events for the canvas elevation layer.
 */
export function _onMouseMove(wrapper, event) {
  wrapper(event);
  canvas.terrain._onMouseMove(event);
}

export const PATCHES = {};
PATCHES.BASIC = { WRAPS: { _onMouseMove } };
