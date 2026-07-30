declare module "sharp" {
  interface SharpImage {
    metadata(): Promise<{
      format?: string;
      height?: number;
      pages?: number;
      width?: number;
    }>;
    png(): SharpImage;
    resize(options: {
      fit: "inside";
      height: number;
      width: number;
      withoutEnlargement: boolean;
    }): SharpImage;
    rotate(): SharpImage;
    timeout(options: { seconds: number }): SharpImage;
    toBuffer(): Promise<Buffer>;
    webp(options: { quality: number }): SharpImage;
  }

  interface SharpFactory {
    (input: Buffer | Uint8Array): SharpImage;
    (
      input: Buffer,
      options: { failOn: "warning"; limitInputPixels: number },
    ): SharpImage;
    (input: {
      create: {
        background: { alpha: number; b: number; g: number; r: number };
        channels: 4;
        height: number;
        width: number;
      };
    }): SharpImage;
  }

  const sharp: SharpFactory;
  export default sharp;
}
