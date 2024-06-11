/* globals
Hooks,
game,
socketlib
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS, ICONS } from "./const.js";
import { log } from "./util.js";
import { TerrainLayer } from "./TerrainLayer.js";
import { TerrainLevel } from "./TerrainLevel.js";
import { Settings } from "./settings.js";
import { Terrain, addTerrainEffect, removeTerrainEffect } from "./Terrain.js";
import { TerrainMap } from "./TerrainMap.js";
import { EffectHelper } from "./EffectHelper.js";
import { PATCHER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";
import { terrainEncounteredDialog, updateTokenDocument } from "./Token.js";

import { TerrainLayerShader } from "./glsl/TerrainLayerShader.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";
import { TerrainLayerPixelCache, TerrainPixelCache, TerrainKey } from "./TerrainPixelCache.js";
import { buildDirPath } from "./TerrainFileManager.js";

import { AddTerrainRegionBehaviorType } from "./regions/AddTerrainRegionBehaviorType.js";
import { RemoveTerrainRegionBehaviorType } from "./regions/RemoveTerrainRegionBehaviorType.js";

// import { BlendFilter } from "./pixi-picture/BlendFilter.js";
// import { applyMixins } from "./pixi-picture/FilterSystemMixin.js";

// Self-executing hooks.
import "./controls.js";
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
  TerrainLayer.register();

  // Must set up the Terrains prior to the region data validation.
  const terrainItem = Settings.terrainEffectsDataItem;
  if ( terrainItem ) {
    for ( const effect of terrainItem.effects ) Terrain.fromEffectId(effect._id);
  }

  Object.assign(CONFIG.RegionBehavior.dataModels, {
    [`${MODULE_ID}.addTerrain`]: AddTerrainRegionBehaviorType,
    [`${MODULE_ID}.removeTerrain`]: RemoveTerrainRegionBehaviorType,
  });

  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.addTerrain`] = ICONS.MODULE;
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.removeTerrain`] = ICONS.MODULE;
});

/**
 * A hook event that fires when Foundry has finished initializing but
 * before the game state has been set up. Fires before any Documents, UI
 * applications, or the Canvas have been initialized.
 */
Hooks.once("setup", function() {
  Settings.registerAll();
});


/**
 * A hook event that fires when the Canvas is ready.
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
Hooks.on("canvasReady", async function(canvas) {
  log("TerrainMapper|canvasReady");
  await Settings.initializeTerrainsItem();
  await canvas.terrain.initialize();
});

// ----- Set up sockets for changing effects on tokens and creating a dialog ----- //
Hooks.once("socketlib.ready", () => {
  SOCKETS.socket = socketlib.registerModule(MODULE_ID);
  SOCKETS.socket.register("addTerrainEffect", addTerrainEffect);
  SOCKETS.socket.register("removeTerrainEffect", removeTerrainEffect);
  SOCKETS.socket.register("dialog", dialog);
  SOCKETS.socket.register("buildDirPath", buildDirPath);
  SOCKETS.socket.register("terrainEncounteredDialog", terrainEncounteredDialog);
  SOCKETS.socket.register("updateTokenDocument", updateTokenDocument);
});

function dialog(data, options) {
  const d = new Dialog(data, options);
  d.render(true);
}

function initializeAPI() {
  game.modules.get(MODULE_ID).api = {
    Terrain,
    TerrainMap,
    EffectHelper,
    Settings,
    PATCHER,
    TerrainLayerShader,
    WallTracerEdge,
    WallTracerVertex,
    WallTracer,
    SCENE_GRAPH,
    TerrainLayerPixelCache,
    TerrainPixelCache,
    TerrainKey,
    TerrainLevel
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
    alphaThreshold: 0.75
  };

}

/* Data Storage

1. Layer elevations: Scene Flag
2. Terrains and terrain effects:
  - Invisible item stored to world.
  - Manual JSON export / import per terrain
  - Manual JSON export / import all terrains
3. Scene map: JSON file at worlds/world-name/assests/terrainmapper/
4. Scene shape queue: JSON file at worlds/world-name/assests/terrainmapper/

*/

/* TODO: Things needed
√ Null Terrain to allow terrain removal at pixel level.
√ Display terrain names on token drag.
√ Remove settings menu
√ Rename TerrainSettings to Settings
√ Import/export single terrain using a temp item to store.
√ Remove ability to add/subtract terrain from scenes; do behind-the-scene
√ Track terrains in scene
√ Layers
- Switch to interaction layer
  - Toggle to display all terrain shapes
  - Allow deletion of terrain shapes
  - Allow swapping of terrain values
  - Allow resizing of terrain polygons
√ Add simplification on load that trims null terrains.
√ Calculate move penalty for token
√ Display an edit scene application that lets the GM assign terrains to scene pixel values.

Control Tools
√ Basic layer controls
√ Terrain type selector
√ Layer selector

Settings
√ Terrain configuration menu
  √ visibility to users: always/never/toggle
  √ name
  √ color
  √ numerical value?
  √ range of effect: low/high.
  √ how to measure the range center: fixed / based on terrain / based on layer
  √ icon
  √ display: icon/color/both

Scene Settings
√ Terrain configuration menu to override for specific scene

Functionality: single layer
√ Store terrain value
√ Retrieve terrain value
√ API to get terrain value for token
√ paint grid
√ paint los
√ paint fill
√ paint polygon

Shape Queue:
√ Restore from save
√ Use separate queue per layer
√ Trim queue after X objects:
  √ grid shapes
  √ polygons

Tiles (overhead and regular):
- Set tile to a terrain
- Set tile to multiple terrains
- For overhead, use the tile elevation
- Incorporate into travel terrain ray

Advanced functionality:
√ store multiple layers
√ retrieve multiple layers
- optional display of another layer as mostly transparent
√ display terrain using distinct colors
√ display terrain using name
- display terrain using repeated icon/image
- toggle to display hide/display terrain to users.
- nested conditions (apply DFred's conditions as a group)

Automation:
- Use point or averaging to obtain terrain value for shape/token
√ travel ray for terrain
√ combined terrain/elevation travel ray
√ On token animation, pause for terrain
- integration with drag ruler
√ integration with elevation ruler
- Active effect flag to limit vision to X feet (fog, forest, etc.). Use Limits?

*/
