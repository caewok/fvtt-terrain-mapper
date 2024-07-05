/* globals
canvas,
CONFIG,
Hooks,
game,
loadTemplates
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FA_ICONS, TEMPLATES } from "./const.js";
import { log } from "./util.js";
import { Settings } from "./settings.js";
import { PATCHER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

// Scene Graph
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";

// Regions
// import { AddTerrainRegionBehaviorType } from "./regions/AddTerrainRegionBehaviorType.js";
// import { RemoveTerrainRegionBehaviorType } from "./regions/RemoveTerrainRegionBehaviorType.js";
import { SetTerrainRegionBehaviorType } from "./regions/SetTerrainRegionBehaviorType.js";
import { SetElevationRegionBehaviorType, constructRegionsPath } from "./regions/SetElevationRegionBehaviorType.js";

// Unique Terrain Effects
import { TerrainActiveEffect, TerrainItemEffect, TerrainFlagEffect, TerrainPF2E } from "./terrain_unique_effects.js";
import { defaultTerrains } from "./default_terrains.js";

// import { BlendFilter } from "./pixi-picture/BlendFilter.js";
// import { applyMixins } from "./pixi-picture/FilterSystemMixin.js";

// Self-executing hooks.
import "./changelog.js";

/**
 * A hook event that fires as Foundry is initializing, right before any
 * initialization tasks have begun.
 */
Hooks.once("init", function() {
  initializePatching();
  initializeConfig();
  initializeAPI();
  registerGeometry();
  Settings.registerAll();

  Object.assign(CONFIG.RegionBehavior.dataModels, {
//     [`${MODULE_ID}.addTerrain`]: AddTerrainRegionBehaviorType,
//     [`${MODULE_ID}.removeTerrain`]: RemoveTerrainRegionBehaviorType,
    [`${MODULE_ID}.setTerrain`]: SetTerrainRegionBehaviorType,
    [`${MODULE_ID}.setElevation`]: SetElevationRegionBehaviorType
  });

//   CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.addTerrain`] = FA_ICONS.MODULE;
//   CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.removeTerrain`] = FA_ICONS.MODULE;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.setTerrain`] = FA_ICONS.MODULE;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.setElevation`] = FA_ICONS.ELEVATE;

  // Must go at end?
  loadTemplates(Object.values(TEMPLATES)).then(_value => log(`Templates loaded.`));
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
Hooks.on("ready", async function(_canvas) {
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
Hooks.on("canvasReady", async function(_canvas) {
  CONFIG[MODULE_ID].Terrain.transitionTokens(); // Async
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
    constructRegionsPath,

    /**
     * API to determine the elevation of a line through 0+ setElevation regions.
     * @param {Point} start             Starting location
     * @param {Point} end               Ending location
     * @param {object} [opts]           Options that affect the path measurement
     * @param {number} [opts.startElevation]   Elevation in grid units
     * @param {number} [opts.endElevation]   Elevation in grid units
     * @returns {RegionMovementSegment}
     */
    estimateElevationForSegment: SetElevationRegionBehaviorType.estimateElevationForSegment
  };
}

function initializeConfig() {
  CONFIG[MODULE_ID] = {
    /**
     * Toggle to trigger debug console logging.
     */
    debug: false,

    /**
     * Alpha threshold below which a tile is considered transparent for purposes of terrain.
     * @type {number} Between 0 and 1
     */
    alphaThreshold: 0.75,

    /**
     * Default terrain jsons
     * @type {string} File path
     */
    defaultTerrainJSONs: defaultTerrains()

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
    bottom == null || bottom >= minElevation;
  });
  elevationRegions = elevationRegions.filter(region => region.testPoint(location, fixedElevation));
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
