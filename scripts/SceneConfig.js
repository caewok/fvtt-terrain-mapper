/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TEMPLATES } from "./const.js";
import { renderTemplateSync } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook renderSceneConfig
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
function renderSceneConfig(app, html, data) {
  const myHTML = renderTemplateSync(TEMPLATES.SCENE, data);
  if ( !myHTML ) return;

  const div = document.createElement("div");
  div.innerHTML = myHTML;

  // Place in the basic tab at the end of the form groups.
  const basicTab = html.find(`.tab[data-tab="basic"][data-group="main"]`)[0];
  if ( !basicTab ) return;
  basicTab.appendChild(div);

  // Alternative way to append directly.
//   const form = html.find(`input[name="initial.scale"]`).closest(".form-group");
//   form.append(myHTML)
  app.setPosition({ height: "auto" });
}

PATCHES.BASIC.HOOKS = { renderSceneConfig };
