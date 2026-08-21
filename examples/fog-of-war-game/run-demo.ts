import { launchOwnedGameDemo } from '../shared/run-owned-game-demo';

launchOwnedGameDemo({
    demoDirectory: import.meta.dir,
    dashboardPort: 3003,
    name: 'Fog of War'
});
