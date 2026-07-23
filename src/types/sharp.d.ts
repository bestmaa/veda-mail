declare module "sharp" {
  interface SharpImage {
    metadata(): Promise<{ format?: string }>;
    resize(options: {
      fit: "inside";
      height: number;
      width: number;
      withoutEnlargement: boolean;
    }): SharpImage;
    rotate(): SharpImage;
    toBuffer(): Promise<Buffer>;
    webp(options: { quality: number }): SharpImage;
  }

  interface SharpFactory {
    (
      input: Buffer,
      options: { failOn: "warning"; limitInputPixels: number },
    ): SharpImage;
  }

  const sharp: SharpFactory;
  export default sharp;
}
