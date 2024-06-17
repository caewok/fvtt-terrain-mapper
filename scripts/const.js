/* globals
game,
Hooks
*/
"use strict";

// Module identifier
export const MODULE_ID = "terrainmapper";

// Placeholder for socket functions
export const SOCKETS = { socket: null };

// Templates used in this module when displaying configs.
export const TEMPLATES = {
  SCENE: `modules/${MODULE_ID}/templates/scene-config.html`,
  ACTIVE_EFFECT: `modules/${MODULE_ID}/templates/active-effect-config.html`,
  TERRAIN_BOOK: `modules/${MODULE_ID}/templates/terrain-effects-menu-app.html`,
  SETTINGS: `modules/${MODULE_ID}/templates/settings-menu-tab-partial.html`
}

// Track certain modules that complement features of this module.
export const MODULES_ACTIVE = {
  ELEVATED_VISION: false,
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
});

// Flags set on various documents.
export const FLAGS = {
  // Active Effects
  UNIQUE_EFFECT: {
    ID: "uniqueEffectId",
    TYPE: "uniqueEffectType",
    DUPLICATES_ALLOWED: "duplicatesAllowed",
    IS_LOCAL: "isLocal",
  },

  // Scene
  SCENE: {
    BACKGROUND_ELEVATION: "backgroundElevation"
  },

  VERSION: "version"
};

// Icons used in this module in controls or tabs
export const ICONS = {
  MODULE: "fa-solid fa-mountain-sun",
  FILL_BY_GRID: "fa-solid fa-brush",
  FILL_BY_LOS: "fa-solid fa-eye",
  FILL_BY_WALLS: "fa-solid fa-fill-drip",
  ELEVATE: "fa-solid fa-elevator",
  TERRAIN_BOOK: "fa-solid fa-mountain-sun"
};
