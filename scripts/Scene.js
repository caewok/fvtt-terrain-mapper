/* globals
canvas,
CONFIG,
CONST,
foundry,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/*
Methods and hooks related to tokens.
Hook token movement to add/remove terrain effects and pause tokens dependent on settings.
*/

import { MODULE_ID, FLAGS } from "./const.js";
import { SceneElevationHandler } from "./regions/RegionElevationHandler.js";
import { Ellipse } from "./geometry/Ellipse.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

// ----- NOTE: Getters ----- //

/**
 * New getter: Region.terrainmapper
 * Class that handles elevation settings and calcs for a region.
 * @type {RegionElevationHandler}
 */
function terrainmapper() { return (this._terrainmapper ??= new SceneElevationHandler(this)); }

PATCHES.REGIONS.GETTERS = { terrainmapper };