/* globals
foundry,
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
  ITEM_PF2e: `modules/${MODULE_ID}/templates/item-config-pf2e.html`,
  REGION: `modules/${MODULE_ID}/templates/region-config.html`,
  TILE: `modules/${MODULE_ID}/templates/tile-config.html`
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
      NONE: "none",
      PLATEAU: "plateau",
      RAMP: "ramp",
    },
    LABELS: {
      none: `${MODULE_ID}.elevationAlgorithm.labels.none`,
      plateau: `${MODULE_ID}.elevationAlgorithm.labels.plateau`,
      ramp: `${MODULE_ID}.elevationAlgorithm.labels.ramp`,
      stairs: `${MODULE_ID}.elevationAlgorithm.labels.stairs`,
    },
    PLATEAU_ELEVATION: "plateauElevation",
    RAMP: {
      FLOOR: "rampFloor",
      DIRECTION: "rampDirection",
      STEP_SIZE: "rampStepSize",
    }

  },

  TILE: {
    IS_FLOOR: "isFloor",
    TRIM_BORDER: "trimAlphaBorder",
    TEST_HOLES: "testHoles",
    ALPHA_THRESHOLD: "alphaThreshold"
  },

  // SetElevationRegionBehavior
  SET_ELEVATION_BEHAVIOR: {
    CHOICES: {
      ONE_WAY: "oneWay",
      STAIRS: "stairs",
    },
    LABELS: {
      oneWay: `${MODULE_ID}.elevationAlgorithm.labels.oneWay`,
      stairs: `${MODULE_ID}.elevationAlgorithm.labels.stairs`,
    }
  },

  VERSION: "version"
};

export const MOVEMENT_TYPES = {
  BURROW: 0,
  WALK: 1,
  FLY: 2
};

export const MOVEMENT_TYPES_INV = foundry.utils.invertObject(MOVEMENT_TYPES);

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

export const DEFAULT_FLAGS = {
  TILE: {
    [FLAGS.TILE.IS_FLOOR]: false,
    [FLAGS.TILE.TRIM_BORDER]: true,
    [FLAGS.TILE.TEST_HOLES]: false,
    [FLAGS.TILE.ALPHA_THRESHOLD]: 0.75
  }
};
