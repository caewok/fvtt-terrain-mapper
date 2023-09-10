/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainSettingsMenu } from "./TerrainSettingsMenu.js";

export const SETTINGS = {

};


export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "menu", {
    name: "Terrain Settings Menu",
    label: `${MODULE_ID}.settings.menu.title`,
    icon: "fas fa-cog",
    type: TerrainSettingsMenu,
    restricted: true
  });
}
