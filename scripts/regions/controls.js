/* globals
RegionBehaviorType
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, ICONS } from "../const.js";

export const PATCHES = {};
PATCHES.REGIONS = {};

const TOOLS = {};
TOOLS.FILL_BY_GRID = {
  name: "fill-by-grid",
  title: `${MODULE_ID}.controls.fill-by-grid.name`,
  icon: ICONS.FILL_BY_GRID,
  toggle: false
};

TOOLS.FILL_BY_LOS = {
  name: "fill-by-los",
  title: `${MODULE_ID}.controls.fill-by-los.name`,
  icon: ICONS.FILL_BY_LOS,
  toggle: false
}

TOOLS.FILL_BY_WALLS = {
  name: "fill-by-walls",
  title: `${MODULE_ID}.controls.fill-space.name`,
  icon: ICONS.FILL_BY_WALLS,
  toggle: false,
  onClick:
}

/**
 * Hook getSceneControlButtons
 * Add additional shape controls to the region controls.
 */
function getSceneControlButtons(controls, _html, _data) {
  if ( !canvas.scene ) return;
  const regionTools = controls.find(c => c.name === "regions");
  if ( !regionTools ) return;
  if ( !canvas.grid.isGridless ) {
    const selectIdx = regionTools.tools.findIndex(t => t.name === "select");
    regionTools.tools.splice(selectIdx + 1, 0, TOOLS.FILL_BY_GRID);
  }
  const polyIdx = regionTools.tools.findIndex(t => t.name === "polygon");
  regionTools.tools.splice(polyIdx + 1, 0, TOOLS.FILL_BY_WALLS);
  regionTools.tools.splice(polyIdx + 1, 0, TOOLS.FILL_BY_LOS);
}

PATCHES.REGIONS.HOOKS = {
  getSceneControlButtons
}

// Hooks.on("renderSceneControls", (controls, _html, _data) => {
//
// });



// Add additional region controls:
// -
// Add pathfinding button to token controls.
// const PATHFINDING_CONTROL = {
//   name: Settings.KEYS.CONTROLS.PATHFINDING,
//   title: `${MODULE_ID}.controls.${Settings.KEYS.CONTROLS.PATHFINDING}.name`,
//   icon: "fa-solid fa-route",
//   toggle: true
// };
//
// // Render the pathfinding control.
// // Render the prefer token control if that setting is enabled.
// Hooks.on("getSceneControlButtons", controls => {
//   if ( !canvas.scene ) return;
//   const tokenTools = controls.find(c => c.name === "token");
//   tokenTools.tools.push(PATHFINDING_CONTROL);
// });
//
// Hooks.on("canvasInit", function(_canvas) {
//   updatePathfindingControl();
//   ui.controls.render(true);
// });
//
// Hooks.on("renderSceneControls", async function(controls, _html, _data) {
//   // Monitor enabling/disabling of custom controls.
//   if ( controls.activeControl !== "token" ) return;
//
//   const toggle = controls.control.tools.find(t => t.name === Settings.KEYS.CONTROLS.PATHFINDING);
//   if ( toggle ) await Settings.set(Settings.KEYS.CONTROLS.PATHFINDING, toggle.active);
// });
//
// function updatePathfindingControl(enable) {
//   enable ??= Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
//   const tokenTools = ui.controls.controls.find(c => c.name === "token");
//   const index = tokenTools.tools.findIndex(b => b.name === Settings.KEYS.CONTROLS.PATHFINDING);
//   if ( !~index ) tokenTools.tools.push(PATHFINDING_CONTROL);
//   PATHFINDING_CONTROL.active = Settings.get(Settings.KEYS.CONTROLS.PATHFINDING);
//   // Do in the hook instead to avoid repetition: ui.controls.render(true);
// }
