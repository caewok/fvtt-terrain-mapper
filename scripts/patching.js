/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Patcher } from "./Patcher.js";

import { PATCHES_SidebarTab, PATCHES_ItemDirectory } from "./settings.js";
import { PATCHES as PATCHES_ActiveEffectConfig } from "./ActiveEffectConfig.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_PIXI_Graphics } from "./PIXI_Graphics.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

export const PATCHES = {
  ActiveEffectConfig: PATCHES_ActiveEffectConfig,
  Canvas: PATCHES_Canvas,
  ItemDirectory: PATCHES_ItemDirectory,
  "PIXI.Graphics": PATCHES_PIXI_Graphics,
  SidebarTab: PATCHES_SidebarTab,
  Token: PATCHES_Token,
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup(game.system.id);
}
