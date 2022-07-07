import register from 'higlass-register';

import CohortTrack from './CohortTrack';
import GeneListTrack from './GeneListTrack';

register({
  name: 'CohortTrack',
  track: CohortTrack,
  config: CohortTrack.config,
});

register({
  name: 'GeneListTrack',
  track: GeneListTrack,
  config: GeneListTrack.config,
});
