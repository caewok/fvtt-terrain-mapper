/* globals
Hooks,
game,
socketlib
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SOCKETS } from "./const.js";
import { TerrainLayer } from "./TerrainLayer.js";
import { TerrainSettings } from "./settings.js";
import { Terrain, TerrainMap, addTerrainEffect, removeTerrainEffect } from "./Terrain.js";
import { EffectHelper } from "./EffectHelper.js";
import { PATCHER, initializePatching } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";

import { TerrainLayerShader } from "./glsl/TerrainLayerShader.js";
import { WallTracerEdge, WallTracerVertex, WallTracer, SCENE_GRAPH } from "./WallTracer.js";

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
  TerrainSettings.registerAll();
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
  await TerrainSettings.initializeTerrainsItem();
});

/**
 * A hook event that fires when the Canvas is ready.
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
Hooks.once("canvasReady", function(canvas, canvasEffects0, canvasEffects1, canvasVisibility) {
  console.debug("canvasReady", canvas, canvasEffects0, canvasEffects1, canvasVisibility);
  canvas.terrain.initialize();

//   await TerrainSettings.initializeTerrainsItem();
//   TerrainLayer.initialize();
});

// ----- Set up sockets for changing effects on tokens and creating a dialog ----- //
Hooks.once("socketlib.ready", () => {
  SOCKETS.socket = socketlib.registerModule(MODULE_ID);
  SOCKETS.socket.register("addTerrainEffect", addTerrainEffect);
  SOCKETS.socket.register("removeTerrainEffect", removeTerrainEffect);
});

function initializeAPI() {
  game.modules.get(MODULE_ID).api = {
    Terrain,
    TerrainMap,
    EffectHelper,
    TerrainSettings,
    PATCHER,
    TerrainLayerShader,
    WallTracerEdge,
    WallTracerVertex,
    WallTracer,
    SCENE_GRAPH
  };
}

/* TODO: Things needed

Control Tools
- Basic layer controls
- Terrain type selector
- Layer selector

Settings
- Terrain configuration menu
  - visibility to users: always/never/toggle
  - name
  - color
  - numerical value?
  - range of effect: low/high.
  - how to measure the range center: fixed / based on terrain / based on layer
  - icon
  - display: icon/color/both
- Move these to a Document Terrain subtype. https://foundryvtt.com/article/module-sub-types/

Scene Settings
- Terrain configuration menu to override for specific scene

Functionality: single layer
- Store terrain value
- Retrieve terrain value
- API to get terrain value for token
- paint grid
- paint los
- paint fill
- paint polygon

Advanced functionality:
- store multiple layers
- retrieve multiple layers
- Terrain value for overhead tiles
- optional display of another layer as mostly transparent
- display terrain using distinct colors
- display terrain using repeated icon/image
- toggle to display hide/display terrain to users.

Automation:
- Use point or averaging to obtain terrain value for shape/token
- travel ray for terrain
- combined terrain/elevation travel ray
- On token animation, pause for terrain
- integration with drag ruler
- integration with elevation ruler
- Active effect flag to limit vision to X feet (fog, forest, etc.)

*/
