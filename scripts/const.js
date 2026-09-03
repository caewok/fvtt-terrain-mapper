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
  SETTINGS: `modules/${MODULE_ID}/templates/settings-menu-tab-partial.html`,
  REGION: `modules/${MODULE_ID}/templates/region-config.html`,
  TILE: `modules/${MODULE_ID}/templates/tile-config.html`,
};

// Track certain modules that complement features of this module.
export const MODULES_ACTIVE = {
  ELEVATED_VISION: false,
  ELEVATION_RULER: false,
  LEVELS: false
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
  MODULES_ACTIVE.ELEVATION_RULER = game.modules.get("elevationruler")?.active;
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
});

// Flags set on various documents.
export const FLAGS = {

  // Scene
  SCENE: {
    BACKGROUND_ELEVATION: "backgroundElevation",
    CONSTRAIN_ELEVATION: "constrainElevation",
  },

  // RegionDocument
  REGION: {
    TERRAIN: {
      TYPE: "elevationAlgorithm",
      CHOICES: {
        NONE: "none",
        PLATEAU: "plateau",
        RAMP: "ramp",
        HILL: "hill",
      },
      LABELS: {
        none: `${MODULE_ID}.elevationAlgorithm.labels.none`,
        plateau: `${MODULE_ID}.elevationAlgorithm.labels.plateau`,
        ramp: `${MODULE_ID}.elevationAlgorithm.labels.ramp`,
        hill: `${MODULE_ID}.elevationAlgorithm.labels.hill`,
      },
    },
    PLATEAU_ELEVATION: "plateauElevation",
    RAMP: {
      FLOOR: "rampFloor",
      DIRECTION: "rampDirection",
      STEP_SIZE: "rampStepSize",
      SPLIT_POLYGONS: "splitPolygons",
    },
    HILL: {
      CURVE: "hillData",
      TYPE: "hillType",
      CHOICES: {
        LINEAR: "linear",
        RIDGE: "ridge",
        SYMMETRICAL: "symmetrical",
      },
      LABELS: {
        linear: `${MODULE_ID}.hillType.labels.linear`,
        ridge: `${MODULE_ID}.hillType.labels.ridge`,
        symmetrical: `${MODULE_ID}.hillType.labels.symmetrical`,
      },
    },
  },

  TILE: {
    IS_FLOOR: "isFloor",
    TRIM_BORDER: "trimAlphaBorder",
    TEST_HOLES: "testHoles",
    ALPHA_THRESHOLD: "alphaThreshold"
  },

  // StairsRegionBehavior
  STAIRS_BEHAVIOR: {
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

// Icons used in this module in controls or tabs
export const FA_ICONS = {
  MODULE: "fa-solid fa-mountain-sun",           // https://fontawesome.com/icons/mountain-sun
  FILL_BY_GRID: "fa-solid fa-brush",            // https://fontawesome.com/icons/brush
  FILL_BY_LOS: "fa-solid fa-eye",               // https://fontawesome.com/icons/eye
  FILL_BY_WALLS: "fa-solid fa-fill-drip",       // https://fontawesome.com/icons/fill-drip
  STAIRS: "fa-solid fa-stairs",                 // https://fontawesome.com/icons/stairs
  ELEVATOR: "fa-solid fa-elevator",             // https://fontawesome.com/icons/elevator
  DRAW_HILL: "fa-solid fa-mountain",            // https://fontawesome.com/icons/mountain
};

export const ICONS = {
  MODULE: "icons/svg/mountain.svg"
};

export const DEFAULT_FLAGS = {
  TILE: {
    [FLAGS.TILE.IS_FLOOR]: false,
    [FLAGS.TILE.TRIM_BORDER]: true,
    [FLAGS.TILE.TEST_HOLES]: false,
    [FLAGS.TILE.ALPHA_THRESHOLD]: 0.75
  },

  SCENE: {
    [FLAGS.SCENE.BACKGROUND_ELEVATION]: 0,
    [FLAGS.SCENE.CONSTRAIN_ELEVATION]: true,
  },

  REGION: {
    [FLAGS.REGION.TERRAIN.TYPE]: FLAGS.REGION.TERRAIN.CHOICES.NONE,

    [FLAGS.REGION.PLATEAU_ELEVATION]: 0,

    [FLAGS.REGION.RAMP.FLOOR]: 0,
    [FLAGS.REGION.RAMP.DIRECTION]: 0,
    [FLAGS.REGION.RAMP.STEP_SIZE]: 0,
    [FLAGS.REGION.RAMP.SPLIT_POLYGONS]: false,

    [FLAGS.REGION.HILL.TYPE]: FLAGS.REGION.HILL.CHOICES.LINEAR,
    [FLAGS.REGION.HILL.CURVE]: [
      0, 0, 1, 0, 0.25, 0, 0.75,  // Curve points.
      -1, 0, 1, 0], // Orientation points, relative to a center. Placed at region bounds along x axis.
  },
};

/**
 * Checks for libGeometery.
 * @type {object}
 */
export const GEOMETRY_LIB_OPTS = {
  // What geometries we need to track.
  placeableGeometries: [
    "Tile",
    "Token",
    "Region",
    "Wall",
    "Level",
  ],
};


