/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainSettingsMenu } from "./TerrainSettingsMenu.js";

export const SETTINGS = {
  TERRAINS: "terrains"
};

// NOTE: Exported functions
export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

export async function setSetting(settingName, value) {
  return await game.settings.set(MODULE_ID, settingName, value);
}

// NOTE: Register settings
export function registerSettings() {

  game.settings.registerMenu(MODULE_ID, "menu", {
    name: "Terrain Settings Menu",
    label: `${MODULE_ID}.settings.menu.title`,
    icon: "fas fa-cog",
    type: TerrainSettingsMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, SETTINGS.TERRAINS, {
    scope: "world",
    config: false,
    default: {} // TODO: Should be stored per-system / world
  });
}
