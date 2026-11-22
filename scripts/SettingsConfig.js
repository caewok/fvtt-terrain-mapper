/* globals
foundry,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, DOCUMENTATION_URL, ISSUE_URL } from "./const.js";


// ----- NOTE: Hooks ----- //

/**
 * Settings manipulations to hide unneeded settings
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
async function renderSettingsConfig(app, html, data) {
  if ( !game.user.isGM ) return;

  const settings = html.querySelectorAll(`[data-tab="${MODULE_ID}"]`)[1]
  if ( !settings ) return;

  const template = `modules/${MODULE_ID}/templates/settings-buttons.html`;
  const myHTML = await foundry.applications.handlebars.renderTemplate(template, data);
  const div = document.createElement("div");
  div.innerHTML = myHTML;
  settings.appendChild(div);
//   app.setPosition(app.position);
//
  activateListenersSettingsConfig(app, html);
}

Hooks.on("renderSettingsConfig", renderSettingsConfig);


// ----- NOTE: Helper functions ----- //

function activateListenersSettingsConfig(app, _html) {
  app.options.actions[`${MODULE_ID}-open-documentation`] = openDocumentation;
  app.options.actions[`${MODULE_ID}-open-issue`]  = openIssue;

  // Documentation button
//   html.querySelector(`[name="${MODULE_ID}-button-documentation"]`).click(openDocumentation.bind(app));
//   html.querySelector(`[name="${MODULE_ID}-button-issue"]`).click(openIssue.bind(app));
}

function openDocumentation(event) {
  event.preventDefault();
  event.stopPropagation();
  window.open(DOCUMENTATION_URL, "_blank");
}

function openIssue(event) {
  event.preventDefault();
  event.stopPropagation();
  window.open(ISSUE_URL, "_blank");
}
