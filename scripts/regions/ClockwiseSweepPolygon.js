/* globals
canvas,
foundry,
Hooks,
Region
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "../const.js";


export const PATCHES = {};
PATCHES.REGIONS = {};



/**
 * Wrap ClockwiseSweepPolygon#_determineEdgeTypes
 * Include region edge types
 *
 * Determine the edge types and their manner of inclusion for this polygon instance.
 * @returns {Record<EdgeTypes, 0|1|2>}
 */
function _determineEdgeTypes(wrapper) {
  const edgeTypes = wrapper();
  edgeTypes.region = 1; // 0 is never include, 1 is test, 2 is always include.
  return edgeTypes;
}

PATCHES.REGIONS.WRAPS = { _determineEdgeTypes };
