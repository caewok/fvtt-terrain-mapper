/* globals
Hooks,
game,
socketlib
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS } from "./const.js";
import { TerrainLayer } from "./TerrainLayer.js";
import { Settings } from "./Settings.js";
import { Terrain, addTerrainEffect, removeTerrainEffect } from "./Terrain.js";
import { TerrainMap } from "./TerrainMap.js";
import { EffectHelper } from "./EffectHelper.js";
import { PATCHER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

import { TerrainLayerShader } from "./glsl/TerrainLayerShader.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";

import { TerrainDrawingsLayer } from "./TerrainDrawingsLayer.js";

// Self-executing hooks.
import "./controls.js";

/**
 * A hook event that fires as Foundry is initializing, right before any
 * initialization tasks have begun.
 */
Hooks.once("init", function() {
  initializePatching();
  initializeAPI();
  registerGeometry();
  TerrainLayer.register();
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
 * A hook event that fires when the game is fully ready.
 */
Hooks.once("ready", function() {
  console.debug("ready");
});

/**
 * A hook event that fires when the Canvas is initialized.
 * @param {Canvas} canvas   The Canvas instance being initialized
 */
Hooks.once("canvasInit", async function(canvas) {
  console.debug("canvasInit", canvas);
  await Settings.initializeTerrainsItem();
});

/**
 * A hook event that fires when the Canvas is ready.
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
Hooks.once("canvasReady", function(canvas, canvasEffects0, canvasEffects1, canvasVisibility) {
  console.debug("canvasReady", canvas, canvasEffects0, canvasEffects1, canvasVisibility);
  canvas.terrain.initialize();

  //canvas.terraindrawings.initialize();

//   await Settings.initializeTerrainsItem();
//   TerrainLayer.initialize();
});

// ----- Set up sockets for changing effects on tokens and creating a dialog ----- //
Hooks.once("socketlib.ready", () => {
  SOCKETS.socket = socketlib.registerModule(MODULE_ID);
  SOCKETS.socket.register("addTerrainEffect", addTerrainEffect);
  SOCKETS.socket.register("removeTerrainEffect", removeTerrainEffect);
  SOCKETS.socket.register("dialog", dialog);
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
    SCENE_GRAPH
  };
}

/* TODO: Things needed
√ Null Terrain to allow terrain removal at pixel level.
√ Display terrain names on token drag.
√ Remove settings menu
√ Rename TerrainSettings to Settings
√ Import/export single terrain using a temp item to store.
√ Remove ability to add/subtract terrain from scenes; do behind-the-scene
√ Track terrains in scene
- Layers
- Switch to interaction layer
  - Toggle to display all terrain shapes
  - Allow deletion of terrain shapes
  - Allow swapping of terrain values
  - Allow resizing of terrain polygons
- Add simplification on load that trims null terrains.
√ Calculate move penalty for token
√ Display an edit scene application that lets the GM assign terrains to scene pixel values.

Control Tools
√ Basic layer controls
√ Terrain type selector
- Layer selector

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
- Store terrain value
- Retrieve terrain value
√ API to get terrain value for token
√ paint grid
√ paint los
√ paint fill
√ paint polygon

Tiles (overhead and regular):
- Set tile to a terrain
- Set tile to multiple terrains
- For overhead, use the tile elevation
- Incorporate into travel terrain ray

Advanced functionality:
- store multiple layers
- retrieve multiple layers
- optional display of another layer as mostly transparent
√ display terrain using distinct colors
√ display terrain using name
- display terrain using repeated icon/image
- toggle to display hide/display terrain to users.

Automation:
- Use point or averaging to obtain terrain value for shape/token
√ travel ray for terrain
√ combined terrain/elevation travel ray
√ On token animation, pause for terrain
- integration with drag ruler
√ integration with elevation ruler
- Active effect flag to limit vision to X feet (fog, forest, etc.). Use Limits?

*/
