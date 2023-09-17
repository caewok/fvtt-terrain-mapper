/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TerrainSettings } from "./settings.js";


/**
 * Remove the terrains item from sidebar so it does not display.
 * From https://github.com/DFreds/dfreds-convenient-effects/blob/main/scripts/ui/remove-custom-item-from-sidebar.js#L3
 * @param {ItemDirectory} dir
 */
export function removeTerrainsItemFromSidebar(dir) {
  if ( !dir instanceof ItemDirectory ) return;
  const id = TerrainSettings.getByName("TERRAINS_ITEM");
  if ( !id ) return;
  const li = directory.element.find(`li[data-document-id="${id}"]`);
  li.remove();
}
