import { Composition } from "remotion";
import {
  VideoBridgeTestComposition,
  type VideoBridgeTestProps,
} from "./Composition";

const defaultProps: VideoBridgeTestProps = {
  sourceFilename: "source-video.mp4",
  durationInFrames: 90,
  sourceWidth: 1280,
  sourceHeight: 720,
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="VideoBridgeCompatibility"
      component={VideoBridgeTestComposition}
      durationInFrames={90}
      fps={30}
      width={1280}
      height={720}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const portrait = props.sourceHeight > props.sourceWidth;
        return {
          durationInFrames: props.durationInFrames,
          width: portrait ? 720 : 1280,
          height: portrait ? 1280 : 720,
        };
      }}
    />
  );
};
