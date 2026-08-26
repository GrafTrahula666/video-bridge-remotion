import {Audio, Video} from '@remotion/media';
import {AbsoluteFill, Sequence, staticFile} from 'remotion';

export type RitualProps = {
  firstFrames: number;
  secondFrames: number;
  overlapFrames: number;
};

export const RitualComposition = ({firstFrames, secondFrames, overlapFrames}: RitualProps) => {
  const secondPlayable = Math.max(1, secondFrames - overlapFrames);
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Sequence from={0} durationInFrames={firstFrames}>
        <Video
          src={staticFile('source-video-1.mp4')}
          durationInFrames={firstFrames}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </Sequence>
      <Sequence from={firstFrames} durationInFrames={secondPlayable}>
        <Video
          src={staticFile('source-video-2.mp4')}
          trimBefore={overlapFrames}
          durationInFrames={secondPlayable}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </Sequence>
      <Audio src={staticFile('ritual-music.wav')} volume={0.92} />
    </AbsoluteFill>
  );
};
