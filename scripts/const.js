/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "terrainmapper";

export const SOCKETS = { socket: null };

export const TEMPLATES = {
  SCENE: `modules/${MODULE_ID}/templates/scene-config.html`,
  ACTIVE_EFFECT: `modules/${MODULE_ID}/templates/active-effect-config.html`
}

export const MODULES_ACTIVE = {
  ELEVATED_VISION: false,
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
});

export const FLAGS = {
  // Active Effects
  EFFECT_ID: "effectId",
  IS_TERRAIN: "isTerrain",
  DUPLICATES_ALLLOWED: "duplicatesAllowed",

  // Scene
  SCENE_BACKGROUND_ELEVATION: "backgroundElevation",
};

/**
 * Icons used for controls in this module.
 */
export const ICONS = {
  MODULE: "fa-solid fa-mountain-sun",
  FILL_BY_GRID: "fa-solid fa-brush",
  FILL_BY_LOS: "fa-solid fa-eye",
  FILL_BY_WALLS: "fa-solid fa-fill-drip",
  ELEVATE: "fa-solid fa-elevator",
  TERRAIN_BOOK: "fa-solid fa-book"
}
