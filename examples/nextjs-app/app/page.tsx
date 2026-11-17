import { FeatureDemo } from './components/FeatureDemo';
import { FlagOverridePanel } from './components/FlagOverridePanel';
import { ServerFlag } from './components/ServerFlag';

/**
 * Main Page Component
 * Client components use @savvagent/nextjs/client; ServerFlag is a Server
 * Component that evaluates a flag through @savvagent/nextjs/server.
 */
export default function Home() {
  return (
    <main>
      <FeatureDemo />
      <ServerFlag />
      <FlagOverridePanel />
    </main>
  );
}
