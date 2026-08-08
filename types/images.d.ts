declare module "*.png" {
    /** Data URI injected by esbuild's dataurl loader */
    const src: string;
    export default src;
}
