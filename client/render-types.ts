/** Browser-only image boundary; game rules do not depend on DOM image constructors. */
export interface CanvasImage {
  ready: boolean;
  img: CanvasImageSource;
  loading?: Promise<unknown>;
}
export type ImageLookup = (path: string) => CanvasImage;
