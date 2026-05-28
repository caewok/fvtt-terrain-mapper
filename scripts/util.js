/* globals
canvas,
CONFIG,
game,
Handlebars,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";


export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(_e) { // eslint-disable-line no-unused-vars
    // Empty
  }
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
 * Helper to get a rectangular bounds between two points.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Rectangle}
 */
export function segmentBounds(a, b) {
  if ( !b || (a.x === b.x && a.y === b.y) ) return new PIXI.Rectangle(a.x - 1, a.y - 1, 3, 3);
  const xMinMax = Math.minMax(a.x, b.x);
  const yMinMax = Math.minMax(a.y, b.y);
  return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
}

/**
 * Synchronous version of renderTemplate.
 * Requires the template to be already loaded.
 * @param {string} path             The file path to the target HTML template
 * @param {Object} data             A data object against which to compile the template
 * @returns {string|undefined}      Returns the compiled and rendered template as a string
 */
export function renderTemplateSync(path, data) {
  if ( !Object.hasOwn(Handlebars.partials, path) ) return;
  const template = Handlebars.partials[path];
  return template(data || {}, {
    allowProtoMethodsByDefault: true,
    allowProtoPropertiesByDefault: true
  });
}

/**
 * Are two region waypoints equal in x,y coordinates?
 * @param {RegionMovementWaypoint} a
 * @param {RegionMovementWaypoint} b
 * @returns {boolean}
 */
export function regionWaypointsXYEqual(a, b) { return a.x === b.x && a.y === b.y; }

export function regionWaypointsXYAlmostEqual(a, b) { return a.x.almostEqual(b.x) && a.y.almostEqual(b.y); }

/**
 * Retrieve all plateau and ramp regions.
 * @param {Region[]} [regions]    Regions to use, if not all regions on the canvas
 * @returns {Region[]}
 */
export function elevatedRegions(regions) {
  regions ??= canvas.regions?.placeables;
  if ( !regions ) return [];
  return regions.filter(region => region[MODULE_ID].isElevated);
}

/**
 * Retrieve all tiles treated as floors and elevated above scene ground.
 * @param {Tile[]} [tiles]    Tiles to use, if not all tiles on the canvas
 * @returns {Tiles[]}
 */
export function elevatedTiles(tiles) {
  tiles ??= canvas.tiles?.placeables;
  if ( !tiles ) return [];
  return tiles.filter(tile => tile[MODULE_ID].isElevated);
}


