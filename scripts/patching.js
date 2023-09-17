/* globals
canvas,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Patcher } from "./Patcher.js";

export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  MeasuredTemplate: PATCHES_MeasuredTemplate,
  MeasuredTemplateConfig: PATCHES_MeasuredTemplateConfig,
  Setting: PATCHES_Setting,
  Token: PATCHES_Token,
  Wall: PATCHES_Wall,
  dnd5e: PATCHES_dnd5e // Only works b/c these are all hooks. Otherwise, would need class breakdown.
};

export const PATCHER = new Patcher(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup(game.system.id);
}

