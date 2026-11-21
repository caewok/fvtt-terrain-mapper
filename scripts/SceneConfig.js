/* globals
canvas,
Hooks,
requestAnimationFrame,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TEMPLATES } from "./const.js";
import { renderTemplateSync } from "./util.js";
// ASSUMPTION: adjust the folder to wherever parallax_geometry.js lives.
import { ParallaxMath } from "./parallax/parallax_geometry.js";
import { parallaxManager } from "./parallax/ParallaxManager.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook renderSceneConfig
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderSceneConfig(app, html, data) {
  const changed = addElevationFields(html, data) | addLightFields(app, html);
  if ( changed ) app.setPosition({ height: "auto" });
}

/**
 * Background elevation and constrain elevation, in the basics tab (unchanged behavior).
 * @returns {boolean} True if something was added
 */
function addElevationFields(html, data) {
  const myHTML = renderTemplateSync(TEMPLATES.SCENE, data);
  if ( !myHTML ) return false;
  const newFormGroup = document.createElement("div");
  newFormGroup.classList.add("form-group");
  newFormGroup.innerHTML = myHTML;

  // Place in the basic tab at the end of the form groups.
  const basicTab = html.querySelector(`.tab[data-tab="basics"]`);
  if ( !basicTab ) return false;

  const formGroups = basicTab.getElementsByClassName("form-group");
  formGroups[formGroups.length - 1].appendChild(newFormGroup);
  return true;
}

/**
 * Light direction (0-360 degrees clockwise from north) and elevation (degrees above the horizon), stored as scene flags.
 * The inputs sit inside the scene config form, so the form's normal submit saves them.
 * @returns {boolean} True if something was added
 */
function addLightFields(app, html) {
  const { direction, elevation } = ParallaxMath.sceneLightSettings(app.document);
  const myHTML = renderTemplateSync(TEMPLATES.SCENE_LIGHT, {
    lightDirection: direction,
    lightElevation: elevation,
    minElevation: ParallaxMath.MIN_ELEVATION,
    maxElevation: ParallaxMath.MAX_ELEVATION,
  });
  if ( !myHTML ) return false;

  const tab = html.querySelector('.tab[data-tab="visibility"]');
  if ( !tab ) return false;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = myHTML;
  tab.append(...wrapper.childNodes);
  addLightPreview(app, tab);
  return true;
}

/**
 * Live preview: move the light as the GM types or spins the inputs, before anything is saved.
 * Only for the scene being viewed. Saving goes through the normal submit (and the updateScene hook);
 * closing without saving restores the saved light (see closeSceneConfig).
 */
function addLightPreview(app, tab) {
  if ( app.document !== canvas.scene ) return;
  const dirInput = tab.querySelector(`input[name="flags.${MODULE_ID}.lightDirection"]`);
  const elevInput = tab.querySelector(`input[name="flags.${MODULE_ID}.lightElevation"]`);
  if ( !(dirInput && elevInput) ) return;

  let pending = false;
  const preview = () => {
    if ( pending ) return; // At most one rebuild per frame while dragging a spinner.
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      parallaxManager.previewLight(dirInput.valueAsNumber, elevInput.valueAsNumber);
    });
  };
  dirInput.addEventListener("input", preview);
  elevInput.addEventListener("input", preview);
}

/**
 * Hook closeSceneConfig
 * Discard any unsaved preview. After a save this just re-applies the saved (new) values.
 * ASSUMPTION: ApplicationV2 fires a close hook named for the class, closeSceneConfig.
 * @param {Application} app
 */
function closeSceneConfig(app) {
  if ( app.document !== canvas.scene ) return;
  parallaxManager.restoreLight();
}

PATCHES.BASIC.HOOKS = { renderSceneConfig, closeSceneConfig };
