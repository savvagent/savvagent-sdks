import type { Route } from './+types/home';
import { FeatureDemo } from '../components/FeatureDemo';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Savvagent React Router Example' }];
}

export default function Home() {
  return <FeatureDemo />;
}
