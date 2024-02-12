/* globals
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(e) {
    // Empty
  }
}

/**
 * Helper to inject configuration html into the application config.
 */
export async function injectConfiguration(app, html, data, template, findString, attachMethod = "append") {
  const myHTML = await renderTemplate(template, data);
  const form = html.find(findString);
  form[attachMethod](myHTML);
  app.setPosition(app.position);
}

/**
 * Capitalize the first letter of a string.
 * @param {string} str
 * @returns {string}
 */
export function capitalizeFirstLetter(str) { return `${str.charAt(0).toUpperCase()}${str.slice(1)}`; }

/**
 * Test if something is a string.
 * See https://stackoverflow.com/questions/4059147/check-if-a-variable-is-a-string-in-javascript
 * @param {*} obj   Object to test
 * @returns {boolean}
 */
export function isString(obj) {
  return (typeof obj === "string" || obj instanceof String);
}

/**
 * From https://stackoverflow.com/questions/14446511/most-efficient-method-to-groupby-on-an-array-of-objects
 * Takes an Array<V>, and a grouping function,
 * and returns a Map of the array grouped by the grouping function.
 *
 * @param {Array} list An array of type V.
 * @param {Function} keyGetter A Function that takes the the Array type V as an input, and returns a value of type K.
 *                  K is generally intended to be a property key of V.
 *                  keyGetter: (input: V) => K): Map<K, Array<V>>
 *
 * @returns Map of the array grouped by the grouping function. map = new Map<K, Array<V>>()
 */
export function groupBy(list, keyGetter) {
  const map = new Map();
  list.forEach(item => {
    const key = keyGetter(item);
    const collection = map.get(key);

    if (!collection) map.set(key, [item]);
    else collection.push(item);
  });
  return map;
}


/**
 * Get the grid shape for a given set of grid coordinates.
 * @param {number[2]} gridCoords      Array of [row, col] grid coordinates. See canvas.grid.grid.getGridPositionFromPixels
 * @returns {PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShapeFromGridCoords(gridCoords) {
  const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  if ( canvas.grid.isHex && width === height ) return hexGridShape(tlx, tly);
  return squareGridShape(tlx, tly)

}

/**
 * Get a square grid shape from the top left corner position.
 * @param {number} tlx      Top left x coordinate
 * @param {number} tly      Top left y coordinate
 * @returns {PIXI.Rectangle}
 */
function squareGridShape(tlx, tly) {
  // Get the top left corner
  const { w, h } = canvas.grid;
  return new PIXI.Rectangle(tlx, tly, w, h);
}

/**
 * Get a hex grid shape from the top left corner position.
 * @param {number} tlx      Top left x coordinate
 * @param {number} tly      Top left y coordinate
 * @returns {PIXI.Polygon}
 */
function hexGridShape(tlx, tly, { width = 1, height = 1 } = {}) {
  // Canvas.grid.grid.getBorderPolygon will return null if width !== height.
  if ( width !== height ) return null;

  // Get the top left corner
  const points = canvas.grid.grid.getBorderPolygon(width, height, 0);
  const pointsTranslated = [];
  const ln = points.length;
  for ( let i = 0; i < ln; i += 2) {
    pointsTranslated.push(points[i] + tlx, points[i+1] + tly);
  }
  return new PIXI.Polygon(pointsTranslated);
}
