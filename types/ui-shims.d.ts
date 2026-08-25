/** Vue single-file components (compiled by unplugin-vue at build time). */
declare module "*.vue" {
    import type { DefineComponent } from "vue";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component: DefineComponent<any, any, any>;
    export default component;
}

/** Stylesheets are bundled as raw text (esbuild "text" loader). */
declare module "*.css" {
    const css: string;
    export default css;
}
