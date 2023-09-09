/* globals
Hooks,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainLayer } from "./TerrainLayer.js";

Hooks.once("init", function() {
  initializeAPI();
  TerrainLayer.register();

});

Hooks.once("ready", function() {

});

function initializeAPI() {
  game.modules.get(MODULE_ID).api = {};
}
