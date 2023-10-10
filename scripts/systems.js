/* globals
game
*/
"use strict";

/**
 * From Drag Ruler
 * https://github.com/manuelVo/foundryvtt-drag-ruler/blob/develop/src/systems.js
 * Attribute corresponding to walking for given systems.
 */
export function getDefaultSpeedAttribute() {
  switch (game.system.id) {
    case "CoC7": return "actor.system.attribs.mov.value";
    case "dcc": return "actor.system.attributes.speed.value";
    case "dnd4e": return "actor.system.movement.walk.value";
    case "dnd5e": return "actor.system.attributes.movement.walk";
    case "lancer": return "actor.system.derived.speed";
    case "pf1":
    case "D35E": return "actor.system.attributes.speed.land.total";
    case "sfrpg": return "actor.system.attributes.speed.value";
    case "shadowrun5e": return "actor.system.movement.walk.value";
    case "swade": return "actor.system.stats.speed.adjusted";
    case "ds4": return "actor.system.combatValues.movement.total";
    case "splittermond": return "actor.derivedValues.speed.value";
    case "wfrp4e": return "actor.system.details.move.walk";
    case "crucible": return "actor.system.movement.stride";
  }
  return "";
}
