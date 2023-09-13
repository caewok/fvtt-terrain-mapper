/* globals
Hooks,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { TerrainLayer } from "./TerrainLayer.js";
import { registerSettings } from "./settings.js";
import { Terrain } from "./Terrain.js";

// Self-executing hooks.
import "./controls.js";

Hooks.once("init", function() {
  initializeAPI();
  TerrainLayer.register();

});

Hooks.once("setup", function() {
  registerSettings();
});

function initializeAPI() {
  game.modules.get(MODULE_ID).api = {
    Terrain
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
