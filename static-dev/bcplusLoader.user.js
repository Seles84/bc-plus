// ==UserScript==
// @name         BC+ - Bondage Club Plus (Dev Loader)
// @namespace    BCPlus
// @version      1.0.1
// @description  Development loader for the "Bondage Club Plus" (BC+) mod - loads from localhost
// @author       Seles
// @include      /^https:\/\/(www\.)?bondageprojects\.elementfx\.com\/R\d+\/(BondageClub|\d+)(\/((index|\d+)\.html)?)?$/
// @include      /^https:\/\/(www\.)?bondage-europe\.com\/R\d+\/(BondageClub|\d+)(\/((index|\d+)\.html)?)?$/
// @include      /^https:\/\/(www\.)?bondage-asia\.com\/club\/R\d+(\/((index|\d+)\.html)?)?$/
// @homepage     https://github.com/Seles84/bc-plus#readme
// @source       https://github.com/Seles84/bc-plus
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
            n.setAttribute("src", "http://localhost:3045/bcplus.js?_=" + Date.now());
            n.onload = () => n.remove();
            document.head.appendChild(n);
        }
    },
    2000
);
