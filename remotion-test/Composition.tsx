import { Video } from "@remotion/media";
import { AbsoluteFill, staticFile } from "remotion";

export type VideoBridgeTestProps = {
  sourceFilename: string;
  durationInFrames: number;
  sourceWidth: number;
  sourceHeight: number;
};

export const VideoBridgeTestComposition = ({ sourceFilename }: VideoBridgeTestProps) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#05070b" }}>
      <Video
        src={staticFile(`input/${sourceFilename}`)}
        objectFit="contain"
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
};
