/* globals
game,
Hooks
*/
"use strict";

// Module identifier
export const MODULE_ID = "terrainmapper";

// Templates used in this module when displaying configs.
export const TEMPLATES = {
  SCENE: `modules/${MODULE_ID}/templates/scene-config.html`,
  ACTIVE_EFFECT: `modules/${MODULE_ID}/templates/active-effect-config.html`,
  TERRAIN_BOOK: `modules/${MODULE_ID}/templates/terrain-effects-menu-app.html`,
  SETTINGS: `modules/${MODULE_ID}/templates/settings-menu-tab-partial.html`,
  ITEM_PF2e: `modules/${MODULE_ID}/templates/item-config-pf2e.html`
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
  // ActiveEffect
  UNIQUE_EFFECT: {
    ID: "uniqueEffectId",
    TYPE: "uniqueEffectType",
    DUPLICATES_ALLOWED: "duplicatesAllowed",
    IS_LOCAL: "isLocal",
    DISPLAY_ICON: "displayStatusIcon"
  },

  // Scene
  SCENE: {
    BACKGROUND_ELEVATION: "backgroundElevation"
  },

  // RegionDocument
  REGION: {
    ELEVATION_ALGORITHM: "elevationAlgorithm",
    CHOICES: {
      PLATEAU: "plateau",
      RAMP: "ramp",
      STAIRS: "stairs"
    },
    LABELS: {
      plateau: `${MODULE_ID}.elevationAlgorithm.labels.plateau`,
      ramp: `${MODULE_ID}.elevationAlgorithm.labels.ramp`,
      stairs: `${MODULE_ID}.elevationAlgorithm.labels.stairs`,
    },
    TELEPORT: "teleport",
    IGNORE_OTHER_ELEVATIONS: "ignoreOtherElevations",
    FLOOR: "elevationFloor",
    DIRECTION: "rampDirection",
    STEP_SIZE: "rampStepSize"
  },

  VERSION: "version"
};

// Icons used in this module in controls or tabs
export const FA_ICONS = {
  MODULE: "fa-solid fa-mountain-sun",
  FILL_BY_GRID: "fa-solid fa-brush",
  FILL_BY_LOS: "fa-solid fa-eye",
  FILL_BY_WALLS: "fa-solid fa-fill-drip",
  ELEVATE: "fa-solid fa-elevator",
  TERRAIN_BOOK: "fa-solid fa-mountain-sun"
};

export const ICONS = {
  MODULE: "icons/svg/mountain.svg"
}
