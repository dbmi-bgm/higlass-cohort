import register from 'higlass-register';

import CohortTrack from './CohortTrack';

register({
  name: 'CohortTrack',
  track: CohortTrack,
  config: CohortTrack.config,
});
