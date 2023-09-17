/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TerrainEffectsApp } from "./TerrainEffectsApp.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Rerender the terrain control app if it is open when the active effect configuration is closed.
 */
function closeActiveEffectConfig(_app, _html) {
  TerrainEffectsApp.rerender();
}

PATCHES.BASIC.HOOKS = { closeActiveEffectConfig };
