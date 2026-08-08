// ==UserScript==
// @name         BC+ - Bondage Club Plus (Loader)
// @namespace    BCPlus
// @version      1.0.0
// @description  Loader for the "Bondage Club Plus" (BC+) mod
// @author       Seles
// @include      /^https:\/\/(www\.)?bondageprojects\.elementfx\.com\/R\d+\/(BondageClub|\d+)(\/((index|\d+)\.html)?)?$/
// @include      /^https:\/\/(www\.)?bondage-europe\.com\/R\d+\/(BondageClub|\d+)(\/((index|\d+)\.html)?)?$/
// @include      /^https:\/\/(www\.)?bondage-asia\.com\/club\/R\d+(\/((index|\d+)\.html)?)?$/
// @homepage     https://github.com/Seles84/bc-plus#readme
// @source       https://github.com/Seles84/bc-plus
// @downloadURL  https://seles84.github.io/bc-plus/bcplusLoader.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

// eslint-disable-next-line no-restricted-globals
setTimeout(
    function () {
        if (window.BCPlus === undefined) {
            const n = document.createElement("script");
            n.setAttribute("language", "JavaScript");
            n.setAttribute("crossorigin", "anonymous");
            n.setAttribute("src", "https://seles84.github.io/bc-plus/bcplus.js?_=" + Date.now());
            n.onload = () => n.remove();
            document.head.appendChild(n);
        }
    },
    2000
);
