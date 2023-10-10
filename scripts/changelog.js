/* globals
Hooks,
game
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
