/* globals
ActiveEffectConfig,
CONST,
game,
ActiveEffect
*/

import { Terrain } from "./Terrain.js";

// Adapted from https://github.com/death-save/combat-utility-belt/blob/master/modules/enhanced-conditions/enhanced-effect-config.js
// @example
// effectConfig = new EnhancedEffectConfig(effect)
// effectConfig.render(true)

class EnhancedEffectConfig extends ActiveEffectConfig {
  /**
   * Get data for template rendering
   * @param {*} options
   * @inheritdoc
   */
  getData(options) { // eslint-disable-line no-unused-vars
    const effect = this.object.toObject();
    return {
      effect: effect, // Backwards compatibility
      data: this.object.toObject(),
      // Manually set effect type
      isActorEffect: true,
      isItemEffect: false,
      submitText: "EFFECT.Submit",
      modes: Object.entries(CONST.ACTIVE_EFFECT_MODES).reduce((obj, e) => {
        obj[e[1]] = game.i18n.localize(`EFFECT.MODE_${e[0]}`);
        return obj;
      }, {})
    };
  }

  /**
   * Override default update object behaviour
   * @param {*} formData
   * @override
   */
  async _updateObject(event, formData) {
    this.object.updateSource(formData);
    if (this._state === 2) await this.render();
  }
}

export class TerrainEffectConfig extends EnhancedEffectConfig {
  /**
   * Retrieve different settings for each terrain.
   */
  constructor(id) {
    super();

    const data = Terrain.TERRAINS.get(id) || {};
    data.name ??= `Terrain.${id}`;
    this.object = new ActiveEffect(data);
  }
}
