/* globals
canvas,
CONFIG,
foundry,
Hooks,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FA_ICONS, TEMPLATES, DEFAULT_FLAGS } from "./const.js";
import { log } from "./util.js";
import { Settings } from "./settings.js";
import { PATCHER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

// Scene Graph
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";

// Regions
import { SetTerrainRegionBehaviorType } from "./regions/SetTerrainRegionBehaviorType.js";
import { StairsRegionBehaviorType } from "./regions/StairsRegionBehaviorType.js";
import { ElevatorRegionBehaviorType } from "./regions/ElevatorRegionBehaviorType.js";
import { BlockingWallsRegionBehaviorType } from "./regions/BlockingWallsRegionBehaviorType.js";
import { StraightLinePath } from "./StraightLinePath.js";

// Elevation
import { TokenElevationHandler, CutawayHandler } from "./TokenElevationHandler.js";

// Unique Terrain Effects
import { TerrainActiveEffect, TerrainItemEffect, TerrainFlagEffect, TerrainPF2E } from "./terrain_unique_effects.js";
import { defaultTerrains } from "./default_terrains.js";

// Self-executing hooks.
import "./changelog.js";
import "./regions/HighlightRegionShader.js";

/**
 * Use dynamic import and try/catch to load module only if successful.
 */
async function loadModuleConditionally(path) {
  try {
    const module = await import(path);
  } catch (error) {
    log(`Failed to load ${path}`);
  }
}

/* Foundry v13 movement
Token#findMovementPath -- find path through waypoints
Token#createTerrainMovementPath - Add intermediate waypoints, RegionBehavior#_getTerrainEffects (difficulty)
Token#constrainMovementPath - "Constrain the given movement path"; checks collisions, finite move cost
Token#measureMovementPath -> TokenDocument#measureMovementPath: accounts for cost, distance
Token#constrainMovementPathCost -> Uses Token#measureMovementPath to reject infinite cost waypoints.
Token##updatePlannedMovement - Update movement for user.
Token##recalculatePlannedMovementPath - update planned path; pathfinding
Token#recalculatePlannedMovementPath - Recalculate path, calling Token##recalculatePlannedMovementPath
Token#_changeDragElevation -- Change elevation presumably based on scroll wheel change; see _onDragMouseWheel
Token#_getKeyboardMovementAction
Token#segmentizeRegionMovementPath - Called in Token#createTerrainMovementPath to create region waypoints


Token#findMovementPath - takes waypoints, options
- Token#createTerrainMovementPath
  - Token#segmentizeRegionMovementPath
- Token#constrainMovementPath(waypoints, opts) --> path
- Returns a path






1. Arrow keys

PlaceablesLayer##handleMovement
PlaceablesLayer#moveMany
...
TokenDocument#preUpdate
TokenDocument##preUpdateMovement
Token#createTerrainMovementPath


TokenDocument#preUpdate
 - TokenDocument##preUpdateMovement
   - options.movement defines the waypoints, method, constrainOptions, autoRotate, showRuler
   - Prepares waypoints using TokenDocument##inferMovementWaypoints
   - Movement is given ID and locked. Only Token.#WRITEABLE_MOVEMENT_OPERATION_PROPERTIES are updated after this (autoRotate, showRuler)
   - Then _preUpdateMovement and preMoveToken hook are called. Accept/reject only.
   - Some later time, preUpdateToken is called, then updateToken, then moveToken hooks

TokenDocument#preUpdate
- options.movement:
  - method: "keyboard"
  - waypoints: Array, each with
     - x
     - y
     - elevation
     - action: "walk"
     - snapped: true
     - explicit: false ??
     - checkpoint: true




3. Token drag ruler

// Ruler drawing done separately:
Token#findMovementPath
 - Token#createTerrainMovementPath
   - Token#segmentizeRegionMovementPath

// Movement once token is dropped:
When moving, TokenDocument#preUpdate is called. But only the destination in changes, no movement option.
action is "update"




4. Update: see Token.document.move
• Update using a movement object in the options. Contains waypoints and method
• See get movement in TokenDocument




*/



/**
 * A hook event that fires as Foundry is initializing, right before any
 * initialization tasks have begun.
 */
Hooks.once("init", function() {
  // Set up testing.
  if ( game.modules.has("quench") && game.modules.get("quench").active ) loadModuleConditionally("../tests/CutawayHandler.test.js");

  initializePatching();
  registerGeometry();
  initializeConfig();
  initializeAPI();
  Settings.registerAll();

  Object.assign(CONFIG.RegionBehavior.dataModels, {
    [`${MODULE_ID}.setTerrain`]: SetTerrainRegionBehaviorType,
    [`${MODULE_ID}.setElevation`]: StairsRegionBehaviorType,
    [`${MODULE_ID}.elevator`]: ElevatorRegionBehaviorType,
    [`${MODULE_ID}.blockingWalls`]: BlockingWallsRegionBehaviorType,
  });

  //   CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.addTerrain`] = FA_ICONS.MODULE;
  //   CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.removeTerrain`] = FA_ICONS.MODULE;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.setTerrain`] = FA_ICONS.MODULE;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.setElevation`] = FA_ICONS.STAIRS;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.elevator`] = FA_ICONS.ELEVATOR;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.blockingWalls`] = FA_ICONS.BLOCKING_WALLS;

  // Must go at end?
  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES)).then(_value => log("Templates loaded."));
});

/**
 * A hook event that fires when Foundry has finished initializing but
 * before the game state has been set up. Fires before any Documents, UI
 * applications, or the Canvas have been initialized.
 */
// Hooks.once("setup", function() {
//
// });

/**
 * A hook event that fires when the game is fully ready.
 */
Hooks.on("ready", function(_canvas) {
  CONFIG[MODULE_ID].Terrain.initialize(); // Async. Must wait until ready hook to store Settings for UniqueEffectFlag
});
//
//
// Hooks.on("canvasInit", async function(_canvas) {
//   log("TerrainMapper|canvasInit");
// });
//
// Hooks.on("canvasDraw", async function(_canvas) {
//   log("TerrainMapper|canvasDraw");
// });

/**
 * A hook event that fires when the Canvas is ready.
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
Hooks.on("canvasReady", function(_canvas) {
  CONFIG[MODULE_ID].Terrain.transitionTokens(); // Async
  if ( game.user.isGM ) {
    setDefaultPlaceablesFlags(); // Async.
    setDefaultSceneFlags(); // Async.
  }
});

function initializeAPI() {
  game.modules.get(MODULE_ID).api = {
    Settings,
    PATCHER,
    WallTracerEdge,
    WallTracerVertex,
    WallTracer,
    SCENE_GRAPH,
    TerrainActiveEffect,
    TerrainItemEffect,
    TerrainFlagEffect,
    regionElevationAtPoint,
    StraightLinePath,
    TokenElevationHandler,
    CutawayHandler,

    /**
     * API to determine the elevation of a line through 0+ setElevation regions.
     * @param {Point} start             Starting location
     * @param {Point} end               Ending location
     * @param {object} [opts]           Options that affect the path measurement
     * @param {number} [opts.startElevation]   Elevation in grid units
     * @param {number} [opts.endElevation]   Elevation in grid units
     * @returns {RegionMovementSegment}
     */
    estimateElevationForSegment: StairsRegionBehaviorType.estimateElevationForSegment,
  };
}

function initializeConfig() {
  CONFIG[MODULE_ID] = {
    /**
     * Toggle to trigger debug console logging.
     * @type {boolean}
     */
    debug: false,

    /**
     * Default terrain jsons
     * @type {string} File path
     */
    defaultTerrainJSONs: defaultTerrains(),

    /**
     * As a percent of token (width/height), how far from the edge can a token move
     * (measured from token center) over transparent tile pixels before it is considered to be in a "hole".
     * Because it is measured from token center, a 50% threshold will effectively allow the
     * token to be completely over transparent pixels before it "falls" through the hole.
     * Note also that holes are measured by the number of pixels one can move from a center pixel
     * before hitting a non-transparent pixel. For uneven edges, this is effectively the
     * closest non-transparent pixel.
     * @type {number} Positive number
     */
    tokenPercentHoleThreshold: 0.25,

    /**
     * Hook active effect creation and deletion.
     * On AE creation, add stand-alone AEs for statuses in the AE.
     * On AE deletion, remove the stand-alone AEs unless another non-stand-alone AE has that status.
     * @type {boolean}
     */
    addStandAloneAEs: true,

    /**
     * When animating an elevation change, what percent of the elevation to move in one frame.
     * Rounds to nearest integer unless the elevation delta is smaller than 1.
     *
     * Example: If moving 30' up, 10% at a time, the elevation counter on the token
     *          would display 0', 3', 6',... 30'.
     * Higher percentages make the elevation counter move faster.
     * @type {number} Between 0 and 1. 0 will be treated as one.
     */
    elevationAnimationPercent: 0.25,

    /**
     * Token actions that are affected by plateaus/ramps
     * both entering and exiting.
     * For example, if at the region edge, the next move is "crawl" and it would take the token
     * into the plateau, the token elevation is adjusted to the top of the plateau before
     * continuing the movement ("crawling" or "climbing" up the terrain).
     * Similarly, if the token moves off the plateau, its elevation is
     * adjusted to the next supporting level.
     * @type {Set<foundry.CONFIG.Token.movement.actions>}
     */
    terrainWalkActions: new Set(["walk", "climb", "crawl"]),

    /**
     * Token actions that are meant to move tokens on or above a terrain but not through them.
     * For example, the token might fly diagonally upward to a terrain edge instead of vertically climbing.
     * @type {Set<foundry.CONFIG.Token.movement.actions>}
     */
    terrainFlightActions: new Set(["fly", "jump"]),

    /**
     * Token actions that are meant to move the token on or within a terrain, but not outside of it.
     * For example, a token might reach a plateau, and to get to the other side, would tunnel
     * through it rather than climb over it.
     * @type {Set<foundry.CONFIG.Token.movement.actions>}
     */
    terrainBurrowActions: new Set(["burrow", "swim"]),

    // DND5e: displace and blink are currently excluded; token will be moved directly.

    ClipperPaths: CONFIG.GeometryLib.ClipperPaths, // Or Clipper2Paths

  };

  Object.defineProperty(CONFIG[MODULE_ID], "UniqueEffect", {
    get: function() { return this.Terrain; }
  });

  /**
   * The terrain type used for this system.
   * @type {TerrainActiveEffect|TerrainItemEffect|TerrainFlagEffect}
   */
  switch ( game.system.id ) {
    case "sfrpg":
    case "pf2e":
      CONFIG[MODULE_ID].Terrain = TerrainPF2E; break;
    default:
      CONFIG[MODULE_ID].Terrain = TerrainActiveEffect;
  }
}

/**
 * API function to determine the elevation at a given point.
 * Tests for regions between a minimum and maximum elevation, from top-down.
 * So if two regions at the location, the highest region counts first.
 * @param {Point} location    {x,y} location to test
 * @param {object} [opts]     Options that limit the regions to test
 * @param {number} [opts.fixedElevation]      Any region that contains this elevation counts
 * @param {number} [opts.maxElevation]        Any region below or equal to this grid elevation counts
 * @param {number} [opts.minElevation]        Any region above or equal to this grid elevation counts
 * @returns {number|undefined} Undefined if no region present; value of Set Elevation otherwise.
 */
function regionElevationAtPoint(location, {
  fixedElevation = undefined,
  maxElevation = Number.POSITIVE_INFINITY,
  minElevation = Number.NEGATIVE_INFINITY } = {}) {

  let elevationRegions = canvas.regions.placeables
    .filter(region => region.document.behaviors
      .some(behavior => behavior.type === `${MODULE_ID}.setElevation`));
  if ( !elevationRegions.length ) return undefined;

  if ( isFinite(maxElevation) ) elevationRegions = elevationRegions.filter(region => {
    const top = region.document?.elevation?.top;
    return top == null || top <= maxElevation;
  });
  if ( isFinite(maxElevation) ) elevationRegions = elevationRegions.filter(region => {
    const bottom = region.document?.elevation?.bottom;
    return bottom == null || bottom >= minElevation;
  });

  const testPt = ElevatedPoint.fromLocationWithElevation(location, fixedElevation);
  elevationRegions = elevationRegions.filter(region => region.testPoint(testPt));
  testPt.release();
  if ( !elevationRegions.length ) return undefined;

  // Locate the highest remaining region. This sets the elevation.
  let maxE = Number.NEGATIVE_INFINITY;
  let highestRegion;
  elevationRegions.forEach(region => {
    const top = region.elevation?.document?.top;
    if ( !top || top > maxE ) {
      maxE = top ?? Number.POSITIVE_INFINITY;
      highestRegion = region;
    }
  });
  if ( !highestRegion ) return;

  // Get the corresponding elevation behavior.
  for ( const behavior of highestRegion.document.behaviors ) {
    if ( behavior.type !== `${MODULE_ID}.setElevation` ) continue;
    return behavior.system.elevation;
  }
  return undefined;
}

/**
 * Set default values for placeables flags.
 */
async function setDefaultPlaceablesFlags() {
  const promises = [];
  for ( const tile of canvas.tiles.placeables ) {
    for ( const [key, defaultValue] of Object.entries(DEFAULT_FLAGS.TILE) ) {
      if ( typeof tile.document.getFlag(MODULE_ID, key) !== "undefined" ) continue;
      promises.push(tile.document.setFlag(MODULE_ID, key, defaultValue));
    }
  }
  await Promise.allSettled(promises);
}

/**
 * Set default values for scene flags.
 */
async function setDefaultSceneFlags() {
  const promises = [];
  for ( const [key, defaultValue] of Object.entries(DEFAULT_FLAGS.SCENE) ) {
    if ( typeof canvas.scene.getFlag(MODULE_ID, key) !== "undefined" ) continue;
    promises.push(canvas.scene.setFlag(MODULE_ID, key, defaultValue));
  }
  await Promise.allSettled(promises);
}
