import {Composition} from 'remotion';
import {RitualComposition} from './Composition';

export const RemotionRoot = () => (
  <Composition id="RitualFinal" component={RitualComposition} durationInFrames={721} fps={24} width={828} height={1108} defaultProps={{firstFrames:361, secondFrames:361, overlapFrames:1}} />
);
