/* globals
canvas,
CONFIG,
PIXI,
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MOVEMENT_TYPES_INV, FLAGS } from "./const.js";

export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(_e) { // eslint-disable-line no-unused-vars
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
 * @type {GridCoordinates} gridCoords  { i: row, j: col } location
 * @returns {PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShapeFromGridCoords(gridCoords) {
  const tl = canvas.grid.getTopLeftPoint(gridCoords);
  if ( canvas.grid.isHexagonal ) return hexGridShape(tl.x, tl.y);
  return squareGridShape(tl.x, tl.y)

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
 * Locates a single active gm.
 * @returns {User|undefined}
 */
export function firstGM() { return game.users?.find((u) => u.isGM && u.active); }

/**
 * Is the current user the first active GM user?
 * @returns {boolean}
 */
export function isFirstGM() { return game.user && game.user.id === firstGM()?.id; }

/**
 * Are two region waypoints equal in all coordinates?
 * @param {RegionMovementWaypoint} a
 * @param {RegionMovementWaypoint} b
 * @returns {boolean}
 */
export function regionWaypointsEqual(a, b) { return a.x === b.x && a.y === b.y && a.elevation === b.elevation; }

/**
 * Are two region waypoints equal in x,y coordinates?
 * @param {RegionMovementWaypoint} a
 * @param {RegionMovementWaypoint} b
 * @returns {boolean}
 */
export function regionWaypointsXYEqual(a, b) { return a.x === b.x && a.y === b.y; }

/**
 * Does this region have a valid, enabled setElevation behavior?
 * @param {Region} region
 * @returns {boolean}
 */
export function hasSetElevation(region) {
  return region.document.behaviors.some(b => !b.disabled && b.type === `${MODULE_ID}.setElevation`)
}

/**
 * Retrieve this region's setElevation behavior, if any.
 * @param {Region} region
 * @returns {RegionBehavior}
 */
export function findSetElevation(region) {
  return region.document.behaviors.find(b => !b.disabled && b.type === `${MODULE_ID}.setElevation`)
}

/**
 * Retrieve all regions with a valid setElevation behavior
 * @param {Region[]} [regions]    Regions to use, if not all regions on the canvas
 * @returns {Region[]}
 */
export function regionsWithSetElevation(regions) {
  regions ??= canvas.regions?.placeables;
  if ( !regions ) return [];
  return regions.filter(region => hasSetElevation(region));
}

/**
 * Is the token flying, on the ground, or below ground for this terrain?
 * @param {Token} token
 * @param {Region} [region]   Is this relative to a specific region?
 * @returns {MOVEMENT_TYPES}
 */
export function tokenMovementType(token, region) {
  return terrainMovementType({ ...token.center, elevation: token.elevationE }, region);
}

/**
 * Is this location considered to be flying, ground, or below ground?
 * @param {RegionMovementWaypoint} waypoint
 * @param {Region} [region]    Is this relative to a specific region? Does not test if point is within region
 * @returns {MOVEMENT_TYPES}
 */
export function terrainMovementType(waypoint, region) {
  let groundE = canvas.scene?.getFlag(MODULE_ID, FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
  const b = findSetElevation(region);
  if ( b
    && b.system.type !== FLAGS.REGION.CHOICES.STAIRS
    && region.testPoint(waypoint, undefined) ) groundE = b.system.plateauElevation(waypoint);
  return Math.sign(waypoint.elevation - groundE) + 1; // 0, 1, or 2.
}

