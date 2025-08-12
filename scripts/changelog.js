/* globals
Dialog,
Hooks,
game,
showdown,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
const CHANGELOG = Settings.KEYS.CHANGELOG;

// From Perfect Vision
// https://github.com/dev7355608/perfect-vision/blob/cdf03ae7e4b5969efaee8e742bf9dd11d18ba8b7/scripts/changelog.js


Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    game.settings.register(
        MODULE_ID,
        CHANGELOG,
        {
            scope: "client",
            config: false,
            type: Number,
            default: 0
        }
    );

    new ChangelogBuilder()
        .addEntry({
            version: "0.0.1",
            title: "Welcome to Terrain Mapper!",
            body: `\
                Thanks for checking out Terrain Mapper!

                To start, click the Terrain Mapper control on the left and open the Terrain Book.
                Add a terrain, and then fill parts of the scene with that terrain. You can also
                drag a terrain to a token's character sheet to add it as an effect.

                This is a brand new module and will definitely have bugs. Please report bugs
                on my [Github page for this module](https://github.com/caewok/fvtt-terrain-mapper/issues).
                Feel free to also suggest improvements or new features by filing a new issue there.`
        })

        .addEntry({
            version: "0.1.0",
            title: "Tiles and Templates",
            body: `\
                You can now add terrains to tiles or templates. The elevation of the tile or template is
                taken into account if the terrain effect area is set to be relative to the level (as opposed to absolute).

                In all cases, the outer transparent border of the tile will be ignored. Note that in the tile configuration,
                you can choose whether to ignore inner transparent portions of the tile. For example, you might have a tile of a
                rectangular balcony that is open (transparent) in the center, and only have the terrain apply to the non-transparent
                balcony portion.`
        })

        .addEntry({
            version: "0.2.0",
            title: "Foundry v12",
            body: `\
                This release offers compatibility for Foundry v12. For v11, please use the v0.1 series.
                Currently, terrains are completely separate from Foundry Regions, but additional releases of Terrain Mapper
                will focus on incorporating terrains into Regions.`
        })

        .addEntry({
            version: "0.3.0",
            title: "Regions!",
            body: `\
                This release is a substantial re-write of the module to take advantage of Foundry v12's regions.
                Two region behaviors are provided: Set Terrain and Set Elevation.

                To use Set Terrain, create one or more "Terrains" (which are essentially Active Effects) using the
                Terrain Book found in the controls on the Region layer. Create a new region, and using the Set Terrain
                region behavior, select one or more terrains. The terrains will be added as active effects to the token when
                a token enters the region, and removed upon exit.

                To use Set Elevation, create a new region, and define an elevation using the Set Elevation region behavior.
                The token will be set to the elevation upon entering the region, and restored to the scene background elevation
                upon exit. You will find this works best if you set the top of the region to the elevation you want to apply.
                (Think of the region as a plateau.)

                For both Set Terrain and Set Elevation, you can overlap 2+ regions to achieve more complex behavior.

                Advanced region drawing tools are also added to the region controls: fill-by-grid, fill-by-line-of-sight, and
                fill-within-walls. These mimic tools provided in previous versions of Terrain Mapper.`
        })

        .addEntry({
            version: "0.4.0",
            title: "Plateaus, Ramps, Steps, Tiles",
            body: `\
                You will now see a new tab in the Region configuration to treat the region as a 3d plateau or mesa.
                If enabled, the region will have a flat top at a given elevation, and tokens moving through the region
                are assumed to "climb" the region to the plateau top. Additional settings allow you to incline the top,
                so it creates a ramp or steps in a given direction.

                Overhead tiles gain configuration options to treat them like "floors" at a given elevation. You can enable
                holes (somewhat performance-intensive) to have tokens fall through sufficiently large transparent "holes" in the tiles.

                Moving tokens across regions with plateaus/ramps/steps automatically adjusts their elevation.

                If you want region stairs/elevator, try using the Stairs region behavior.

                This release offers better compatibility with Elevation Ruler v0.10 for measuring token movement and move penalties.`
        })

        .addEntry({
            version: "0.4.1",
            title: "Elevators and Stairs",
            body: `\
                The "setElevation" region behavior is now renamed "stairs". Stairs can be one-way or two-way.
                Options include presenting a dialog to the user to choose whether or not to take the stairs.

                A new "elevator" region behavior allows the GM to define a region that presents a user with a dialog
                to choose between multiple elevations.

                If the stairs or elevator result in an elevation change, the token movement will stop at the region entrypoint,
                because the change in elevation could modify what the token can see. If there is no elevation change
                (e.g., user canceled) then the token movement will continue across the region.`
        })

        .build()
        ?.render(true);
});


/**
 * Display a dialog with changes; store changes as entries.
 */
class ChangelogBuilder {
    #entries = [];

    addEntry({ version, title = "", body }) {
        this.#entries.push({ version, title, body });
        return this;
    }

    build() {
        const converter = new showdown.Converter();
        const curr = Settings.get(CHANGELOG);
        const next = this.#entries.length;
        let content = "";

        if (curr >= next) {
            return;
        }

        for (let [index, { version, title, body }] of this.#entries.entries()) {
            let entry = `<strong>v${version}</strong>${title ? ": " + title : ""}`;;

            if (index < curr) {
                entry = `<summary>${entry}</summary>`;
            } else {
                entry = `<h3>${entry}</h3>`;
            }

            let indentation = 0;

            while (body[indentation] === " ") indentation++;

            if (indentation) {
                body = body.replace(new RegExp(`^ {0,${indentation}}`, "gm"), "");
            }

            entry += converter.makeHtml(body);

            if (index < curr) {
                entry = `<details>${entry}</details><hr>`;
            } else if (index === curr) {
                entry += `<hr><hr>`;
            }

            content = entry + content;
        }

        return new Dialog({
            title: "Terrain Mapper: Changelog",
            content,
            buttons: {
                view_documentation: {
                    icon: `<i class="fas fa-book"></i>`,
                    label: "View documentation",
                    callback: () => window.open("https://github.com/caewok/fvtt-terrain-mapper/blob/master/README.md")
                },
                dont_show_again: {
                    icon: `<i class="fas fa-times"></i>`,
                    label: "Don't show again",
                    callback: async () => await Settings.set(CHANGELOG, next)
                }
            },
            default: "dont_show_again"
        });
    }
}
