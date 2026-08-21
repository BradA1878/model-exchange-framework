import { launchOwnedGameDemo } from '../shared/run-owned-game-demo';

launchOwnedGameDemo({
    demoDirectory: import.meta.dir,
    dashboardPort: 3007,
    name: 'Twenty Questions',
    tensorflowEnabled: true
});
